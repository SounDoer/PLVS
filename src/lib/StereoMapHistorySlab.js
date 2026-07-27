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
  };
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

function summarizeChunkRows(chunk, firstRow, rowCount, bandCentersHz) {
  const summary = createStereoMapHoldSummary(bandCentersHz.length);
  for (let row = firstRow; row < firstRow + rowCount; row += 1) {
    accumulateStereoMapHold(summary, primitiveRowFromChunk(chunk, row, bandCentersHz));
  }
  return summary;
}

function copyActiveTail(chunk, retainedStartSequence, bandCentersHz) {
  const bandCount = bandCentersHz.length;
  const firstRow = Math.max(0, retainedStartSequence - chunk.sequenceStart);
  const rowCount = chunk.rowCount - firstRow;
  const firstValue = firstRow * bandCount;
  const valueCount = rowCount * bandCount;
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
    holdSummary:
      firstRow === 0
        ? copyStereoMapHoldSummary(chunk.holdSummary)
        : summarizeChunkRows(chunk, firstRow, rowCount, bandCentersHz),
  };
}

function payloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.pl.byteLength +
    chunk.pr.byteLength +
    chunk.c.byteLength +
    stereoMapHoldSummaryByteLength(chunk.holdSummary)
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

function findChunk(chunks, sequence) {
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
      return chunk;
    }
  }
  return undefined;
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
    total: bytes.timestamps + bytes.bandCenters + bytes.pl + bytes.pr + bytes.c + bytes.holdIndex,
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
  const allocated = {
    timestamps: 0,
    bandCenters: state.bandCentersHz.byteLength,
    pl: 0,
    pr: 0,
    c: 0,
    holdIndex: 0,
  };
  const used = {
    timestamps: 0,
    bandCenters: state.bandCentersHz.byteLength,
    pl: 0,
    pr: 0,
    c: 0,
    holdIndex: 0,
  };

  for (const chunk of state.chunks) {
    allocated.timestamps += chunk.timestamps?.byteLength ?? 0;
    allocated.pl += chunk.pl?.byteLength ?? 0;
    allocated.pr += chunk.pr?.byteLength ?? 0;
    allocated.c += chunk.c?.byteLength ?? 0;
    allocated.holdIndex += stereoMapHoldSummaryByteLength(chunk.holdSummary);

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
  }

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

    const summary = createStereoMapHoldSummary(state.bandCentersHz.length);
    const stats = { mergedChunks: 0, scannedRows: 0 };
    for (const chunk of state.chunks) {
      if (chunk.epoch !== epoch || chunk.sequenceStart > targetSequence) continue;
      const retainedStart = Math.max(state.startSequence, chunk.sequenceStart);
      const chunkEnd = chunk.sequenceStart + chunk.rowCount;
      const includedEnd = Math.min(targetSequence + 1, chunkEnd);
      if (retainedStart >= includedEnd) continue;

      if (chunk.sealed && retainedStart === chunk.sequenceStart && includedEnd === chunkEnd) {
        mergeStereoMapHoldSummary(summary, chunk.holdSummary);
        stats.mergedChunks += 1;
        continue;
      }

      for (let sequence = retainedStart; sequence < includedEnd; sequence += 1) {
        accumulateStereoMapHold(
          summary,
          primitiveRowFromChunk(chunk, sequence - chunk.sequenceStart, state.bandCentersHz)
        );
        stats.scannedRows += 1;
      }
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
}

function dropExpiredChunks(state) {
  while (
    state.chunks.length > 0 &&
    state.chunks[0].sequenceStart + state.chunks[0].rowCount <= state.startSequence
  ) {
    state.chunks.shift();
  }
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
   */
  liveHoldValues() {
    const state = stateOf(this);
    if (state.bandCentersHz.length === 0) return null;
    const summary = createStereoMapHoldSummary(state.bandCentersHz.length);
    for (const chunk of state.chunks) {
      mergeStereoMapHoldSummary(summary, chunk.holdSummary);
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
    if (addsChunk) state.chunks.push(active);

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
        const copied = copyActiveTail(chunk, state.startSequence, state.bandCentersHz);
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
    });
  }

  get version() {
    return 0;
  }

  get sampleRateHz() {
    return stateOf(this).sampleRateHz;
  }
}
