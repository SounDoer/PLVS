import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { createStereoMapDerivationScratch } from "../math/stereoMapMath.js";
import {
  accumulateStereoMapHold,
  copyStereoMapHoldSummary,
  createStereoMapHoldSummary,
  mergeStereoMapHoldSummary,
  stereoMapHoldSummaryByteLength,
  stereoMapHoldValues,
} from "../math/stereoMapHold.js";

const VISUAL_ROWS_PER_SECOND = 25;
export const MAX_STEREO_MAP_HISTORY_ROWS = 4 * 60 * 60 * VISUAL_ROWS_PER_SECOND;

/**
 * How many rows one within-chunk Hold checkpoint covers (see {@link pushHoldCheckpoint}). Trades
 * retained bytes against the row scan a Hold query still has to do after the nearest checkpoint:
 * a query scans fewer than this many rows, and a chunk carries `rowCapacity / stride - 1`
 * checkpoints. At 958 bands that is 15 checkpoints of ~41 KiB against an ~11.2 MiB chunk payload,
 * i.e. ~5.4% more retained bytes to turn a ~1000-row scan into a <64-row one.
 */
export const HOLD_CHECKPOINT_STRIDE = 64;
const states = new WeakMap();
const frozenConstructionToken = Symbol("FrozenStereoMapHistory");

function stateOf(view) {
  const state = states.get(view);
  if (!state) throw new TypeError("Invalid Stereo Map history view");
  return state;
}

function assertCapacity(capacity) {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("StereoMapHistorySlab capacity must be a positive integer");
  }
  if (capacity > MAX_STEREO_MAP_HISTORY_ROWS) {
    throw new RangeError("StereoMapHistorySlab retention cannot exceed four hours");
  }
}

function sameFloat32Values(stored, incoming) {
  if (stored.length !== incoming.length) return false;
  for (let index = 0; index < stored.length; index += 1) {
    if (!Object.is(stored[index], incoming[index])) return false;
  }
  return true;
}

function createCanonicalizationScratch(bandCount) {
  return {
    bandCount,
    centers: new Float32Array(bandCount),
    pl: new Float32Array(bandCount),
    pr: new Float32Array(bandCount),
    c: new Float32Array(bandCount),
  };
}

function canonicalizeFloat32(target, values, message) {
  for (let index = 0; index < target.length; index += 1) {
    const value = Math.fround(values[index]);
    if (!Number.isFinite(value)) throw new RangeError(message);
    target[index] = value;
  }
}

function canonicalizeRow(state, { timestampMs, sampleRateHz, bandCentersHz, pl, pr, c }) {
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError("StereoMapHistorySlab timestamp must be finite");
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("StereoMapHistorySlab sample rate must be finite and positive");
  }
  const bandCount = bandCentersHz?.length ?? 0;
  if (pl?.length !== bandCount || pr?.length !== bandCount || c?.length !== bandCount) {
    throw new RangeError("StereoMapHistorySlab primitive plane lengths must match the band grid");
  }

  const scratch =
    state.scratch?.bandCount === bandCount
      ? state.scratch
      : createCanonicalizationScratch(bandCount);
  canonicalizeFloat32(
    scratch.centers,
    bandCentersHz ?? [],
    "StereoMapHistorySlab band centers must be finite after Float32 conversion"
  );
  canonicalizeFloat32(
    scratch.pl,
    pl,
    "StereoMapHistorySlab primitive planes must contain finite Float32 values"
  );
  canonicalizeFloat32(
    scratch.pr,
    pr,
    "StereoMapHistorySlab primitive planes must contain finite Float32 values"
  );
  canonicalizeFloat32(
    scratch.c,
    c,
    "StereoMapHistorySlab primitive planes must contain finite Float32 values"
  );
  return scratch;
}

function createChunk(sequenceStart, bandCount, epoch) {
  return {
    sequenceStart,
    epoch,
    rowCapacity: VISUAL_HISTORY_CHUNK_ROWS,
    rowCount: 0,
    sealed: false,
    timestamps: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    pl: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
    pr: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
    c: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
    holdSummary: createStereoMapHoldSummary(bandCount),
    holdCheckpoints: [],
  };
}

/**
 * Snapshot the chunk's running Hold prefix every {@link HOLD_CHECKPOINT_STRIDE} rows, so a query
 * targeting a row inside this chunk can start from the nearest checkpoint instead of re-deriving
 * every row from the chunk's start. `holdCheckpoints[j]` covers rows `[0, (j + 1) * stride)`.
 *
 * This is free beyond the copy itself: `chunk.holdSummary` is already the running prefix that
 * {@link StereoMapHistorySlab#append} maintains row by row, so a checkpoint is a memcpy of it, not
 * a re-derivation. A full chunk needs no final checkpoint — its own `holdSummary` already covers
 * every row, and a query including all of them merges that whole-chunk summary instead.
 */
function pushHoldCheckpoint(chunk) {
  if (chunk.rowCount % HOLD_CHECKPOINT_STRIDE !== 0) return;
  if (chunk.rowCount >= chunk.rowCapacity) return;
  chunk.holdCheckpoints.push(copyStereoMapHoldSummary(chunk.holdSummary));
}

function primitiveRowFromChunk(chunk, row, bandCentersHz) {
  const firstValue = row * bandCentersHz.length;
  const lastValue = firstValue + bandCentersHz.length;
  return {
    bandCentersHz,
    pl: chunk.pl.subarray(firstValue, lastValue),
    pr: chunk.pr.subarray(firstValue, lastValue),
    c: chunk.c.subarray(firstValue, lastValue),
  };
}

/**
 * Re-derive a Hold summary, plus its checkpoints, for a contiguous row range of `chunk`. Used when
 * freeze copies a partially-evicted tail: the copy renumbers its rows from zero, so the source
 * chunk's summary and checkpoints (which count from the source's own row 0) no longer describe it.
 */
function summarizeChunkRows(chunk, firstRow, rowCount, bandCentersHz, scratch) {
  const summary = createStereoMapHoldSummary(bandCentersHz.length);
  const holdCheckpoints = [];
  for (let row = firstRow; row < firstRow + rowCount; row += 1) {
    accumulateStereoMapHold(summary, primitiveRowFromChunk(chunk, row, bandCentersHz), scratch);
    const copiedRows = row - firstRow + 1;
    if (copiedRows % HOLD_CHECKPOINT_STRIDE === 0 && copiedRows < rowCount) {
      holdCheckpoints.push(copyStereoMapHoldSummary(summary));
    }
  }
  return { summary, holdCheckpoints };
}

function copyActiveTail(chunk, retainedStartSequence, bandCentersHz, scratch) {
  const bandCount = bandCentersHz.length;
  const firstRow = Math.max(0, retainedStartSequence - chunk.sequenceStart);
  const rowCount = chunk.rowCount - firstRow;
  const firstValue = firstRow * bandCount;
  const valueCount = rowCount * bandCount;
  // Nothing evicted: the source's own summary and checkpoints already describe rows 0..rowCount,
  // so they only need copying. The summary must be a copy because the source keeps accumulating
  // into it; the checkpoints are never written again after creation, so they are shared.
  const hold =
    firstRow === 0
      ? {
          summary: copyStereoMapHoldSummary(chunk.holdSummary),
          holdCheckpoints: chunk.holdCheckpoints.slice(),
        }
      : summarizeChunkRows(chunk, firstRow, rowCount, bandCentersHz, scratch);
  return {
    sequenceStart: chunk.sequenceStart + firstRow,
    epoch: chunk.epoch,
    rowCapacity: rowCount,
    rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(firstRow, firstRow + rowCount),
    pl: chunk.pl.slice(firstValue, firstValue + valueCount),
    pr: chunk.pr.slice(firstValue, firstValue + valueCount),
    c: chunk.c.slice(firstValue, firstValue + valueCount),
    holdSummary: hold.summary,
    holdCheckpoints: hold.holdCheckpoints,
  };
}

function holdCheckpointBytes(chunk) {
  let total = 0;
  for (const checkpoint of chunk.holdCheckpoints) {
    total += stereoMapHoldSummaryByteLength(checkpoint);
  }
  return total;
}

function payloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.pl.byteLength +
    chunk.pr.byteLength +
    chunk.c.byteLength +
    stereoMapHoldSummaryByteLength(chunk.holdSummary) +
    holdCheckpointBytes(chunk)
  );
}

function holdDerivationScratchFor(state, bandCount) {
  if (!state.holdScratch || state.holdScratch.bandCount !== bandCount) {
    state.holdScratch = createStereoMapDerivationScratch(bandCount);
  }
  return state.holdScratch;
}

function derivationScratchBytes(scratch) {
  if (!scratch) return 0;
  return (
    scratch.normalizedPl.byteLength +
    scratch.normalizedPr.byteLength +
    scratch.normalizedC.byteLength +
    scratch.scale.byteLength +
    scratch.geometricMean.byteLength +
    scratch.energyDb.byteLength
  );
}

function findChunkIndex(chunks, sequence) {
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const chunk = chunks[middle];
    if (sequence < chunk.sequenceStart) {
      high = middle - 1;
    } else if (sequence >= chunk.sequenceStart + chunk.rowCount) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return -1;
}

function findChunk(chunks, sequence) {
  const index = findChunkIndex(chunks, sequence);
  return index === -1 ? undefined : chunks[index];
}

/**
 * Fold one chunk's rows into `summary`, from the chunk's own first row up to (and including)
 * `endSequenceExclusive - 1`. Used for the two chunks a Hold query cannot serve from the cached
 * cross-chunk prefix: the front chunk, and the target chunk itself (which may be unsealed or only
 * partially included).
 *
 * Three tiers, cheapest first: a fully-included sealed chunk is one whole-summary merge; a partial
 * include starts from the nearest {@link pushHoldCheckpoint} checkpoint; only the rows past that
 * checkpoint — always fewer than {@link HOLD_CHECKPOINT_STRIDE} — are re-derived.
 *
 * Eviction is deliberately not honoured here. Bounding the front chunk to `state.startSequence`
 * would force a scan from the retention boundary, unbounded by any checkpoint (Hold extrema cannot
 * be subtracted, so a prefix checkpoint cannot be "rewound" past evicted rows) — the one remaining
 * per-scrub term that grew to a full chunk. `liveHoldValues` has always merged the front chunk
 * whole, evicted prefix included, so folding it whole here makes historical Hold agree with live
 * Hold rather than diverge from it. Fully evicted chunks are dropped in `dropExpiredChunks`, so the
 * over-inclusion can never exceed the oldest retained chunk.
 */
function foldChunkPrefix(state, chunk, endSequenceExclusive, summary, stats) {
  const chunkEnd = chunk.sequenceStart + chunk.rowCount;
  const includedRows = Math.min(endSequenceExclusive, chunkEnd) - chunk.sequenceStart;
  if (includedRows <= 0) return;

  if (chunk.sealed && includedRows === chunk.rowCount) {
    mergeStereoMapHoldSummary(summary, chunk.holdSummary);
    stats.mergedChunks += 1;
    return;
  }

  let firstRow = 0;
  const checkpointIndex = Math.floor(includedRows / HOLD_CHECKPOINT_STRIDE) - 1;
  const checkpoint = checkpointIndex >= 0 ? chunk.holdCheckpoints[checkpointIndex] : undefined;
  if (checkpoint) {
    mergeStereoMapHoldSummary(summary, checkpoint);
    stats.mergedCheckpoints += 1;
    firstRow = (checkpointIndex + 1) * HOLD_CHECKPOINT_STRIDE;
  }

  const scratch = holdDerivationScratchFor(state, state.bandCentersHz.length);
  for (let row = firstRow; row < includedRows; row += 1) {
    accumulateStereoMapHold(
      summary,
      primitiveRowFromChunk(chunk, row, state.bandCentersHz),
      scratch
    );
    stats.scannedRows += 1;
  }
}

/**
 * Push a cached "prefix Hold" for a newly-sealed chunk about to be appended at `state.chunks[i]`:
 * the merge of every chunk strictly between the retained front chunk (index 0, exclusive — it may
 * still be partially evicted, so it is deliberately never folded into any cached prefix) and this
 * new chunk. `state.holdPrefixCache[1]` is always empty by definition; every later entry is one
 * incremental merge step from the previous chunk's own cached prefix plus its own already-final
 * holdSummary — O(bandCount), not a rescan of the whole retained history.
 *
 * The cache is a plain array parallel to `state.chunks`, owned by this state alone — never a
 * field on the (possibly cross-view-shared) chunk object itself. A sealed chunk object can be
 * referenced by both a live slab and one or more frozen snapshots of it, each with its own chunk
 * array and therefore its own valid prefix at a given position; caching on the shared object would
 * let one view's rebuild silently corrupt another's.
 *
 * When the cache is currently dirty (a prior eviction hasn't been rebuilt yet), this leaves the
 * array short: `ensureHoldPrefixCache` will fill in every entry from index 1 onward in one pass
 * the next time a query needs it, so no work is wasted computing an incremental step from a stale
 * base.
 */
function attachHoldPrefixBefore(state) {
  const priorLength = state.chunks.length;
  if (priorLength === 0 || state.holdPrefixDirty) return;
  // The new chunk is about to be pushed and will land at index `priorLength` — assign by index
  // (not push) so a fresh cache with an unused hole at index 0 stays aligned with `state.chunks`.
  if (priorLength === 1) {
    state.holdPrefixCache[priorLength] = createStereoMapHoldSummary(state.bandCentersHz.length);
    return;
  }
  const previous = state.holdPrefixCache[priorLength - 1];
  const next = copyStereoMapHoldSummary(previous);
  mergeStereoMapHoldSummary(next, state.chunks[priorLength - 1].holdSummary);
  state.holdPrefixCache[priorLength] = next;
}

/**
 * Rebuild every chunk's cached prefix Hold (see {@link attachHoldPrefixBefore}) from scratch.
 * Only needed after eviction removes chunks from the front: the chunk that used to sit at index 1
 * (whose cached prefix is always empty) is gone, so every surviving chunk's cached prefix was
 * computed relative to a front chunk that no longer exists and must be recomputed relative to the
 * new one. This is O(retainedChunks * bandCount), but it runs once per eviction event rather than
 * once per query — the many Hold queries between eviction events each stay O(bandCount).
 */
function ensureHoldPrefixCache(state) {
  if (!state.holdPrefixDirty) return;
  const { chunks } = state;
  const cache = new Array(chunks.length);
  for (let index = 1; index < chunks.length; index += 1) {
    if (index === 1) {
      cache[index] = createStereoMapHoldSummary(state.bandCentersHz.length);
      continue;
    }
    const next = copyStereoMapHoldSummary(cache[index - 1]);
    mergeStereoMapHoldSummary(next, chunks[index - 1].holdSummary);
    cache[index] = next;
  }
  state.holdPrefixCache = cache;
  state.holdPrefixDirty = false;
}

function rowFromChunk(chunk, sequence, bandCentersHz, sampleRateHz) {
  const row = sequence - chunk.sequenceStart;
  const firstValue = row * bandCentersHz.length;
  const lastValue = firstValue + bandCentersHz.length;
  return {
    timestampMs: chunk.timestamps[row],
    sampleRateHz,
    bandCentersHz: bandCentersHz.slice(),
    pl: chunk.pl.slice(firstValue, lastValue),
    pr: chunk.pr.slice(firstValue, lastValue),
    c: chunk.c.slice(firstValue, lastValue),
  };
}

function arrayTypeAcrossChunks(chunks, field) {
  if (chunks.length === 0) return null;
  let type = null;
  for (const chunk of chunks) {
    const value = chunk[field];
    const current = ArrayBuffer.isView(value) ? value.constructor.name : "missing";
    if (type !== null && type !== current) return "mixed";
    type = current;
  }
  return type;
}

function withTotal(bytes) {
  return {
    ...bytes,
    total:
      bytes.timestamps +
      bytes.bandCenters +
      bytes.pl +
      bytes.pr +
      bytes.c +
      bytes.holdIndex +
      bytes.holdCheckpoints +
      bytes.holdPrefix,
  };
}

function workingBytes(state) {
  const scratch = state?.scratch;
  const bytes = {
    centers: scratch?.centers.byteLength ?? 0,
    pl: scratch?.pl.byteLength ?? 0,
    pr: scratch?.pr.byteLength ?? 0,
    c: scratch?.c.byteLength ?? 0,
    holdDerivation: derivationScratchBytes(state?.holdScratch),
  };
  return {
    ...bytes,
    total: bytes.centers + bytes.pl + bytes.pr + bytes.c + bytes.holdDerivation,
  };
}

function storageDiagnostics(state) {
  // The prefix cache is diagnostic-only until a query rebuilds it; force it current so the
  // reported byte count reflects the fully-built cache rather than a transiently dirty one.
  ensureHoldPrefixCache(state);

  const allocated = {
    timestamps: 0,
    bandCenters: state.bandCentersHz.byteLength,
    pl: 0,
    pr: 0,
    c: 0,
    holdIndex: 0,
    holdCheckpoints: 0,
    holdPrefix: 0,
  };
  const used = {
    timestamps: 0,
    bandCenters: state.bandCentersHz.byteLength,
    pl: 0,
    pr: 0,
    c: 0,
    holdIndex: 0,
    holdCheckpoints: 0,
    holdPrefix: 0,
  };

  state.chunks.forEach((chunk, index) => {
    allocated.timestamps += chunk.timestamps?.byteLength ?? 0;
    allocated.pl += chunk.pl?.byteLength ?? 0;
    allocated.pr += chunk.pr?.byteLength ?? 0;
    allocated.c += chunk.c?.byteLength ?? 0;
    allocated.holdIndex += stereoMapHoldSummaryByteLength(chunk.holdSummary);
    allocated.holdCheckpoints += holdCheckpointBytes(chunk);
    // Only chunks at index >= 1 carry a cached prefix (index 0 is the possibly-partially-evicted
    // front chunk, deliberately never cached — see `attachHoldPrefixBefore`).
    const prefix = index === 0 ? null : state.holdPrefixCache[index];
    allocated.holdPrefix += prefix ? stereoMapHoldSummaryByteLength(prefix) : 0;

    const retainedStart = Math.max(state.startSequence, chunk.sequenceStart);
    const retainedEnd = Math.min(state.endSequence, chunk.sequenceStart + chunk.rowCount);
    const retainedRows = Math.max(0, retainedEnd - retainedStart);
    used.timestamps += retainedRows * (chunk.timestamps?.BYTES_PER_ELEMENT ?? 0);
    used.pl += retainedRows * state.bandCentersHz.length * (chunk.pl?.BYTES_PER_ELEMENT ?? 0);
    used.pr += retainedRows * state.bandCentersHz.length * (chunk.pr?.BYTES_PER_ELEMENT ?? 0);
    used.c += retainedRows * state.bandCentersHz.length * (chunk.c?.BYTES_PER_ELEMENT ?? 0);
    // The Hold index is a fixed-size per-band summary, not a per-row buffer, so partial
    // retention within a chunk does not shrink it: allocated and used always match.
    used.holdIndex += stereoMapHoldSummaryByteLength(chunk.holdSummary);
    // Checkpoints are fixed-size per-band summaries too, so partial retention never shrinks them.
    used.holdCheckpoints += holdCheckpointBytes(chunk);
    used.holdPrefix += prefix ? stereoMapHoldSummaryByteLength(prefix) : 0;
  });

  return {
    arrayTypes: {
      timestamps: arrayTypeAcrossChunks(state.chunks, "timestamps"),
      bandCenters: state.bandCentersHz.constructor.name,
      primitives: {
        pl: arrayTypeAcrossChunks(state.chunks, "pl"),
        pr: arrayTypeAcrossChunks(state.chunks, "pr"),
        c: arrayTypeAcrossChunks(state.chunks, "c"),
      },
    },
    allocatedBytes: withTotal(allocated),
    usedBytes: withTotal(used),
    holdIndexBytes: { allocated: allocated.holdIndex, used: used.holdIndex },
    holdPrefixBytes: { allocated: allocated.holdPrefix, used: used.holdPrefix },
    gridCopies: state.gridCopies ?? 0,
    workingBytes: workingBytes(state),
  };
}

class StereoMapHistoryView {
  get length() {
    const state = stateOf(this);
    return state.endSequence - state.startSequence;
  }

  timestampAt(index) {
    const state = stateOf(this);
    const sequence = sequenceAt(state, index);
    if (sequence == null) return NaN;
    const chunk = findChunk(state.chunks, sequence);
    return chunk.timestamps[sequence - chunk.sequenceStart];
  }

  rowAt(index) {
    const state = stateOf(this);
    const sequence = sequenceAt(state, index);
    if (sequence == null) return undefined;
    return rowFromChunk(
      findChunk(state.chunks, sequence),
      sequence,
      state.bandCentersHz,
      state.sampleRateHz
    );
  }

  get epoch() {
    return stateOf(this).epoch;
  }

  holdAt(index, epoch = this.epoch) {
    const state = stateOf(this);
    const targetSequence = sequenceAt(state, index);
    if (targetSequence == null || epoch !== state.epoch) return null;
    ensureHoldPrefixCache(state);

    const summary = createStereoMapHoldSummary(state.bandCentersHz.length);
    const stats = { mergedChunks: 0, mergedCheckpoints: 0, scannedRows: 0 };
    const { chunks } = state;
    const targetChunkIndex = findChunkIndex(chunks, targetSequence);
    if (targetChunkIndex === -1) return { values: stereoMapHoldValues(summary), stats };

    // The front chunk (index 0) may be partially evicted, so it is never folded into a cached
    // cross-chunk prefix — fold it directly, bounded by its own checkpoints.
    const front = chunks[0];
    if (front.sequenceStart <= targetSequence) {
      foldChunkPrefix(state, front, targetSequence + 1, summary, stats);
    }

    if (targetChunkIndex >= 1) {
      const targetChunk = chunks[targetChunkIndex];
      // Everything strictly between the front chunk and the target chunk is already folded into
      // one O(bandCount) cached merge, regardless of how many chunks that spans.
      if (targetChunkIndex >= 2) {
        mergeStereoMapHoldSummary(summary, state.holdPrefixCache[targetChunkIndex]);
        stats.mergedChunks += 1;
      }
      // Chunks at index >= 1 are always fully retained (only the front chunk can be partial), so
      // this only needs to bound the query's own target — one checkpoint plus a sub-stride scan.
      foldChunkPrefix(state, targetChunk, targetSequence + 1, summary, stats);
    }

    return { values: stereoMapHoldValues(summary), stats };
  }

  /**
   * Resolve the Hold query for the last row at or before `timestampMs` (timestamps are
   * monotonic across appends). Returns null when no retained row is at or before it.
   */
  holdAtOrBeforeTimestamp(timestampMs, epoch = this.epoch) {
    const length = this.length;
    let low = 0;
    let high = length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.timestampAt(middle) <= timestampMs) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found === -1) return null;
    return this.holdAt(found, epoch);
  }

  storageStats() {
    const state = stateOf(this);
    return {
      chunkCount: state.chunks.length,
      retainedRows: this.length,
      sharedSealedChunks: state.sharedSealedChunks ?? 0,
      copiedTailRows: state.copiedTailRows ?? 0,
      copiedTailBytes: state.copiedTailBytes ?? 0,
      ...storageDiagnostics(state),
    };
  }
}

function sequenceAt(state, index) {
  const length = state.endSequence - state.startSequence;
  if (!Number.isInteger(index) || index < 0 || index >= length) return null;
  return state.startSequence + index;
}

function startFresh(state) {
  state.chunks = [];
  state.startSequence = 0;
  state.endSequence = 0;
  state.epoch += 1;
  state.holdPrefixDirty = false;
}

function dropExpiredChunks(state) {
  let dropped = false;
  while (
    state.chunks.length > 0 &&
    state.chunks[0].sequenceStart + state.chunks[0].rowCount <= state.startSequence
  ) {
    state.chunks.shift();
    dropped = true;
  }
  // Whatever chunk now sits at index 0 wasn't there when surviving chunks' cached prefixes were
  // built, so every cached prefix must be recomputed relative to it — see
  // `attachHoldPrefixBefore`'s "index 0 is never folded in" invariant.
  if (dropped) state.holdPrefixDirty = true;
}

export class StereoMapHistorySlab extends StereoMapHistoryView {
  constructor(capacity) {
    super();
    assertCapacity(capacity);
    states.set(this, {
      capacity,
      chunks: [],
      bandCentersHz: new Float32Array(0),
      sampleRateHz: NaN,
      startSequence: 0,
      endSequence: 0,
      epoch: 0,
      version: 0,
      scratch: null,
      holdScratch: null,
      gridCopies: 0,
      holdPrefixDirty: false,
      holdPrefixCache: [],
    });
  }

  get capacity() {
    return stateOf(this).capacity;
  }

  get version() {
    return stateOf(this).version;
  }

  get sampleRateHz() {
    return stateOf(this).sampleRateHz;
  }

  /**
   * Merges every retained chunk's already-incrementally-maintained Hold summary into one
   * "as of now" result — the shared, per-Analysis-Key surface every Workspace/Dock consumer of
   * this key reads live Hold from, so accumulation lives once here rather than once per panel
   * instance. Each chunk's `holdSummary` (sealed or still active) is updated in {@link append} as
   * rows arrive, so this only merges precomputed per-chunk summaries — it never rescans primitive
   * planes, keeping it cheap enough for a live render path. Like historical Hold at a retention
   * boundary, this can include a little more than the strictly retained window (the oldest
   * retained chunk's already-evicted prefix keeps contributing to its whole-chunk summary); the
   * design doc allows live/historical Hold to diverge there.
   *
   * Merges the same cached per-chunk prefix {@link holdAt} uses, so this costs O(bandCount) —
   * the front chunk's own summary, the last chunk's cached prefix (already covering every chunk
   * strictly between them), and the last chunk's own summary — instead of re-merging every
   * retained chunk from scratch on every live frame tick.
   */
  liveHoldValues() {
    const state = stateOf(this);
    if (state.bandCentersHz.length === 0) return null;
    ensureHoldPrefixCache(state);

    const summary = createStereoMapHoldSummary(state.bandCentersHz.length);
    const { chunks } = state;
    if (chunks.length === 0) return stereoMapHoldValues(summary);

    mergeStereoMapHoldSummary(summary, chunks[0].holdSummary);
    if (chunks.length >= 2) {
      const lastIndex = chunks.length - 1;
      mergeStereoMapHoldSummary(summary, state.holdPrefixCache[lastIndex]);
      mergeStereoMapHoldSummary(summary, chunks[lastIndex].holdSummary);
    }
    return stereoMapHoldValues(summary);
  }

  append({ timestampMs, sampleRateHz, bandCentersHz, pl, pr, c }) {
    const state = stateOf(this);
    const scratch = canonicalizeRow(state, {
      timestampMs,
      sampleRateHz,
      bandCentersHz,
      pl,
      pr,
      c,
    });
    const incompatible =
      this.length > 0 &&
      (!Object.is(state.sampleRateHz, sampleRateHz) ||
        !sameFloat32Values(state.bandCentersHz, scratch.centers));
    const installsGrid = this.length === 0 || incompatible;
    const nextBandCenters = installsGrid ? scratch.centers.slice() : state.bandCentersHz;
    const currentActive = incompatible ? null : state.chunks[state.chunks.length - 1];
    const addsChunk = !currentActive || currentActive.sealed;
    const active = addsChunk
      ? createChunk(
          incompatible ? 0 : state.endSequence,
          scratch.bandCount,
          incompatible ? state.epoch + 1 : state.epoch
        )
      : currentActive;

    if (incompatible) startFresh(state);
    state.scratch = scratch;
    if (installsGrid) {
      state.sampleRateHz = sampleRateHz;
      state.bandCentersHz = nextBandCenters;
      state.gridCopies += 1;
    }
    if (addsChunk) {
      attachHoldPrefixBefore(state);
      state.chunks.push(active);
    }

    const row = active.rowCount;
    const firstValue = row * state.bandCentersHz.length;
    active.timestamps[row] = timestampMs;
    active.pl.set(scratch.pl, firstValue);
    active.pr.set(scratch.pr, firstValue);
    active.c.set(scratch.c, firstValue);
    accumulateStereoMapHold(
      active.holdSummary,
      {
        bandCentersHz: state.bandCentersHz,
        pl: scratch.pl,
        pr: scratch.pr,
        c: scratch.c,
      },
      holdDerivationScratchFor(state, state.bandCentersHz.length)
    );
    active.rowCount += 1;
    pushHoldCheckpoint(active);
    active.sealed = active.rowCount === active.rowCapacity;
    state.endSequence += 1;
    state.startSequence = Math.max(state.startSequence, state.endSequence - state.capacity);
    dropExpiredChunks(state);
    state.version += 1;
  }

  freeze() {
    const state = stateOf(this);
    const chunks = [];
    let sharedSealedChunks = 0;
    let copiedTailRows = 0;
    let copiedTailBytes = 0;

    for (const chunk of state.chunks) {
      if (chunk.sequenceStart + chunk.rowCount <= state.startSequence) continue;
      if (chunk.sealed) {
        chunks.push(chunk);
        sharedSealedChunks += 1;
      } else {
        const copied = copyActiveTail(
          chunk,
          state.startSequence,
          state.bandCentersHz,
          holdDerivationScratchFor(state, state.bandCentersHz.length)
        );
        chunks.push(copied);
        copiedTailRows = copied.rowCount;
        copiedTailBytes = payloadBytes(copied);
      }
    }

    return new FrozenStereoMapHistory(
      {
        chunks,
        bandCentersHz: state.bandCentersHz,
        sampleRateHz: state.sampleRateHz,
        startSequence: state.startSequence,
        endSequence: state.endSequence,
        epoch: state.epoch,
        sharedSealedChunks,
        copiedTailRows,
        copiedTailBytes,
        gridCopies: state.gridCopies,
      },
      frozenConstructionToken
    );
  }

  clear() {
    const state = stateOf(this);
    startFresh(state);
    state.sampleRateHz = NaN;
    state.bandCentersHz = new Float32Array(0);
  }
}

export class FrozenStereoMapHistory extends StereoMapHistoryView {
  constructor(
    {
      chunks,
      bandCentersHz,
      sampleRateHz,
      startSequence,
      endSequence,
      epoch,
      sharedSealedChunks,
      copiedTailRows,
      copiedTailBytes,
      gridCopies,
    },
    token
  ) {
    super();
    if (token !== frozenConstructionToken) {
      throw new TypeError("FrozenStereoMapHistory does not support direct construction");
    }
    states.set(this, {
      chunks,
      bandCentersHz,
      sampleRateHz,
      startSequence,
      endSequence,
      epoch,
      sharedSealedChunks,
      copiedTailRows,
      copiedTailBytes,
      gridCopies,
      scratch: null,
      // The frozen chunk array may not match the live slab's chunk order by the time it's
      // queried (the live slab keeps appending/evicting after freeze), so the cache is never
      // assumed valid here — it lazily rebuilds itself, into its own array, against this
      // instance's own chunk array on first use (see `ensureHoldPrefixCache`).
      holdPrefixDirty: true,
      holdPrefixCache: [],
    });
  }

  get version() {
    return 0;
  }

  get sampleRateHz() {
    return stateOf(this).sampleRateHz;
  }
}
