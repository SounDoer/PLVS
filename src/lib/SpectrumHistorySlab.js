import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import {
  ChunkedHistorySlab,
  FrozenChunkedHistory,
  baseChunk,
  chunkOffsetForSequence,
} from "./ChunkedHistorySlab.js";
import { CENTI_DB_NO_VALUE, decodeCentiDb, encodeCentiDb } from "./packedHistoryCodecs.js";

const EMPTY_F32 = new Float32Array(0);

function centerOf(band) {
  return band?.fCenter;
}

function sameBands(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(centerOf(a[i]), centerOf(b[i]))) return false;
  }
  return true;
}

function copyPrimaryRow(target, offset, bandCount, values) {
  for (let i = 0; i < bandCount; i += 1) {
    target[offset + i] = encodeCentiDb(values?.[i]);
  }
}

function copySecondaryRow(target, offset, bandCount, values) {
  for (let i = 0; i < bandCount; i += 1) {
    target[offset + i] = encodeCentiDb(values?.[i]);
  }
}

function mergePackedMax(target, source) {
  for (let i = 0; i < target.length; i += 1) {
    if (source[i] > target[i]) target[i] = source[i];
  }
}

function mergePackedRow(target, source, offset) {
  for (let i = 0; i < target.length; i += 1) {
    const value = source[offset + i];
    if (value > target[i]) target[i] = value;
  }
}

function chunkSchema(bands, bandCount) {
  return {
    name: "SpectrumHistorySlab",
    createChunk: (sequenceStart) => ({
      ...baseChunk(sequenceStart),
      rowCapacity: VISUAL_HISTORY_CHUNK_ROWS,
      // The widest gap between two consecutive rows inside this chunk, so a gap query can skip a
      // chunk whole instead of walking its rows.
      maxInternalTimestampDeltaMs: -Infinity,
      bands,
      dbA: new Int16Array(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
      maxA: new Int16Array(bandCount).fill(CENTI_DB_NO_VALUE),
      // The second curve is allocated only once a row actually carries one: most sessions are
      // combined-channel and would otherwise pay for a second grid they never fill.
      dbB: null,
      hasB: null,
    }),
    cloneChunk: (chunk) => ({
      sequenceStart: chunk.sequenceStart,
      rowCapacity: chunk.rowCapacity,
      rowCount: chunk.rowCount,
      sealed: true,
      maxInternalTimestampDeltaMs: chunk.maxInternalTimestampDeltaMs,
      bands: chunk.bands,
      timestamps: chunk.timestamps.slice(0, chunk.rowCount),
      dbA: chunk.dbA.slice(0, chunk.rowCount * bandCount),
      maxA: chunk.maxA.slice(),
      dbB: chunk.dbB?.slice(0, chunk.rowCount * bandCount) ?? null,
      maxB: chunk.maxB?.slice() ?? null,
      hasB: chunk.hasB?.slice(0, chunk.rowCount) ?? null,
    }),
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength +
      chunk.dbA.byteLength +
      chunk.maxA.byteLength +
      (chunk.dbB?.byteLength ?? 0) +
      (chunk.maxB?.byteLength ?? 0) +
      (chunk.hasB?.byteLength ?? 0),
  };
}

function maxHoldInChunks(
  chunks,
  retainedStartSequence,
  retainedEndSequence,
  index,
  bandCount,
  hasSecondary
) {
  const length = retainedEndSequence - retainedStartSequence;
  if (index < 0 || index >= length) return null;

  const queryEndSequence = retainedStartSequence + index + 1;
  const maxA = new Int16Array(bandCount).fill(CENTI_DB_NO_VALUE);
  const maxB = hasSecondary ? new Int16Array(bandCount).fill(CENTI_DB_NO_VALUE) : null;

  for (const chunk of chunks) {
    const chunkEndSequence = chunk.sequenceStart + chunk.rowCount;
    const firstSequence = Math.max(retainedStartSequence, chunk.sequenceStart);
    const endSequence = Math.min(queryEndSequence, chunkEndSequence);
    if (firstSequence >= endSequence) continue;

    if (firstSequence === chunk.sequenceStart && endSequence === chunkEndSequence) {
      mergePackedMax(maxA, chunk.maxA);
      if (maxB && chunk.maxB) mergePackedMax(maxB, chunk.maxB);
      continue;
    }

    for (let sequence = firstSequence; sequence < endSequence; sequence += 1) {
      const row = chunkOffsetForSequence(sequence);
      const offset = row * bandCount;
      mergePackedRow(maxA, chunk.dbA, offset);
      if (maxB && chunk.dbB && chunk.hasB?.[row]) mergePackedRow(maxB, chunk.dbB, offset);
    }
  }

  return {
    dbList: decodedRow(maxA, decodePrimary),
    dbListB: maxB ? decodedRow(maxB, decodeSecondary) : EMPTY_F32,
  };
}

function decodePrimary(value) {
  return decodeCentiDb(value);
}

function decodeSecondary(value) {
  return value === CENTI_DB_NO_VALUE ? NaN : decodeCentiDb(value);
}

function decodedRow(source, decode) {
  return Float32Array.from(source, decode);
}

function rowFrom(chunk, row, bandCount, bands) {
  const offset = row * bandCount;
  const primary = chunk.dbA.subarray(offset, offset + bandCount);
  const secondary =
    chunk.dbB && chunk.hasB?.[row] ? chunk.dbB.subarray(offset, offset + bandCount) : null;
  let dbList;
  let dbListB;
  return {
    bands,
    packedDbList: primary,
    packedDbListB: secondary ?? EMPTY_F32,
    get dbList() {
      dbList ??= decodedRow(primary, decodePrimary);
      return dbList;
    },
    get dbListB() {
      if (!secondary) return EMPTY_F32;
      dbListB ??= decodedRow(secondary, decodeSecondary);
      return dbListB;
    },
    dbAt(index) {
      return index >= 0 && index < bandCount ? decodePrimary(primary[index]) : undefined;
    },
    dbBAt(index) {
      if (!secondary || index < 0 || index >= bandCount) return undefined;
      return decodeSecondary(secondary[index]);
    },
    timestampMs: chunk.timestamps[row],
  };
}

function packedStorageStats(base) {
  return {
    ...base,
    valueArrayType: "Int16Array",
    bytesPerValue: Int16Array.BYTES_PER_ELEMENT,
  };
}

function readableTimestamp(timestampMs) {
  return Number.isFinite(timestampMs) ? timestampMs : NaN;
}

function emptyGapQueryStats() {
  return { chunksInspected: 0, rowsScanned: 0 };
}

function appendGapIfNeeded(out, previousTimestampMs, nextTimestampMs, maxGapMs) {
  if (
    Number.isFinite(previousTimestampMs) &&
    Number.isFinite(nextTimestampMs) &&
    nextTimestampMs - previousTimestampMs > maxGapMs
  ) {
    out.push({ previousTimestampMs, nextTimestampMs });
  }
}

function timestampGapBoundariesInChunks(
  chunks,
  retainedStartSequence,
  retainedEndSequence,
  startIndex,
  endIndex,
  maxGapMs
) {
  const stats = emptyGapQueryStats();
  const out = [];
  const retainedLength = retainedEndSequence - retainedStartSequence;
  const firstIndex = Math.max(0, Math.ceil(startIndex));
  const lastIndex = Math.min(retainedLength - 1, Math.floor(endIndex));
  if (firstIndex >= lastIndex || !(maxGapMs >= 0)) return { boundaries: out, stats };

  const firstSequence = retainedStartSequence + firstIndex;
  const lastSequence = retainedStartSequence + lastIndex;
  let previousChunk = null;

  for (const chunk of chunks) {
    const chunkFirstSequence = chunk.sequenceStart;
    const chunkLastSequence = chunk.sequenceStart + chunk.rowCount - 1;
    if (chunkLastSequence < firstSequence) {
      previousChunk = chunk;
      continue;
    }
    if (chunkFirstSequence > lastSequence) break;
    stats.chunksInspected += 1;

    if (previousChunk) {
      const previousSequence = previousChunk.sequenceStart + previousChunk.rowCount - 1;
      if (previousSequence >= firstSequence && chunkFirstSequence <= lastSequence) {
        appendGapIfNeeded(
          out,
          previousChunk.timestamps[previousChunk.rowCount - 1],
          chunk.timestamps[0],
          maxGapMs
        );
      }
    }

    const scanFirstSequence = Math.max(firstSequence, chunkFirstSequence);
    const scanLastSequence = Math.min(lastSequence, chunkLastSequence);
    if (scanFirstSequence < scanLastSequence && chunk.maxInternalTimestampDeltaMs > maxGapMs) {
      stats.rowsScanned += scanLastSequence - scanFirstSequence + 1;
      let previousTimestampMs = chunk.timestamps[chunkOffsetForSequence(scanFirstSequence)];
      for (let sequence = scanFirstSequence + 1; sequence <= scanLastSequence; sequence += 1) {
        const nextTimestampMs = chunk.timestamps[chunkOffsetForSequence(sequence)];
        appendGapIfNeeded(out, previousTimestampMs, nextTimestampMs, maxGapMs);
        previousTimestampMs = nextTimestampMs;
      }
    }
    previousChunk = chunk;
  }

  return { boundaries: out, stats };
}

export class SpectrumHistorySlab extends ChunkedHistorySlab {
  constructor(capacity, bands) {
    const grid = bands ?? [];
    super(capacity, chunkSchema(grid, grid.length));
    this._bands = grid;
    this._bandCount = grid.length;
    this._hasSecondary = false;
    this._lastGapQueryStats = emptyGapQueryStats();
  }

  get bandCount() {
    return this._bandCount;
  }

  get bands() {
    return this._bands;
  }

  get hasSecondary() {
    return this._hasSecondary;
  }

  timestampAt(index) {
    return readableTimestamp(super.timestampAt(index));
  }

  timestampGapBoundaries(startIndex, endIndex, maxGapMs) {
    const result = timestampGapBoundariesInChunks(
      this._chunks,
      this._startSequence,
      this._nextSequence,
      startIndex,
      endIndex,
      maxGapMs
    );
    this._lastGapQueryStats = result.stats;
    return result.boundaries;
  }

  lastGapQueryStats() {
    return { ...this._lastGapQueryStats };
  }

  matchesBands(bands) {
    return sameBands(this._bands, bands ?? []);
  }

  push({ bands, dbList, dbListB, timestampMs }) {
    if (!this.matchesBands(bands)) {
      throw new RangeError("SpectrumHistorySlab cannot store rows with a different band grid");
    }

    this.appendRow(timestampMs, (chunk, row) => {
      const offset = row * this._bandCount;
      if (row > 0) {
        const previousTimestampMs = chunk.timestamps[row - 1];
        const storedTimestampMs = chunk.timestamps[row];
        const deltaMs =
          Number.isFinite(previousTimestampMs) && Number.isFinite(storedTimestampMs)
            ? storedTimestampMs - previousTimestampMs
            : Infinity;
        chunk.maxInternalTimestampDeltaMs = Math.max(chunk.maxInternalTimestampDeltaMs, deltaMs);
      }
      copyPrimaryRow(chunk.dbA, offset, this._bandCount, dbList);
      mergePackedRow(chunk.maxA, chunk.dbA, offset);

      if (dbListB?.length) {
        if (!chunk.dbB) {
          chunk.dbB = new Int16Array(chunk.rowCapacity * this._bandCount);
          chunk.maxB = new Int16Array(this._bandCount).fill(CENTI_DB_NO_VALUE);
          chunk.hasB = new Uint8Array(chunk.rowCapacity);
        }
        copySecondaryRow(chunk.dbB, offset, this._bandCount, dbListB);
        mergePackedRow(chunk.maxB, chunk.dbB, offset);
        chunk.hasB[row] = 1;
        this._hasSecondary = true;
      }
    });
  }

  at(index, { copyRows = false } = {}) {
    const found = this.chunkAt(index);
    if (!found) return undefined;
    return rowFrom(found.chunk, found.row, this._bandCount, this._bands, copyRows);
  }

  rowAt(index) {
    return this.at(index);
  }

  maxHoldAt(index) {
    return maxHoldInChunks(
      this._chunks,
      this._startSequence,
      this._nextSequence,
      index,
      this._bandCount,
      this._hasSecondary
    );
  }

  toArray(options) {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i += 1) {
      out[i] = this.at(i, options);
    }
    return out;
  }

  freeze() {
    return new FrozenSpectrumHistory({
      bands: this._bands,
      bandCount: this._bandCount,
      hasSecondary: this._hasSecondary,
      ...this.freezeChunks(),
    });
  }

  storageStats() {
    return packedStorageStats(super.storageStats());
  }

  clear() {
    super.clear();
    this._hasSecondary = false;
    this._lastGapQueryStats = emptyGapQueryStats();
  }
}

export class FrozenSpectrumHistory extends FrozenChunkedHistory {
  constructor({ bands, bandCount, hasSecondary, ...storage }) {
    super(storage);
    this._bands = bands ?? [];
    this._bandCount = bandCount;
    this._hasSecondary = hasSecondary;
    this._lastGapQueryStats = emptyGapQueryStats();
  }

  timestampAt(index) {
    return readableTimestamp(super.timestampAt(index));
  }

  timestampGapBoundaries(startIndex, endIndex, maxGapMs) {
    const result = timestampGapBoundariesInChunks(
      this._chunks,
      this._startSequence,
      this._endSequence,
      startIndex,
      endIndex,
      maxGapMs
    );
    this._lastGapQueryStats = result.stats;
    return result.boundaries;
  }

  lastGapQueryStats() {
    return { ...this._lastGapQueryStats };
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    if (!found) return undefined;
    return rowFrom(found.chunk, found.row, this._bandCount, this._bands, false);
  }

  maxHoldAt(index) {
    return maxHoldInChunks(
      this._chunks,
      this._startSequence,
      this._endSequence,
      index,
      this._bandCount,
      this._hasSecondary
    );
  }

  storageStats() {
    return packedStorageStats(super.storageStats());
  }
}

export const EMPTY_SPECTRUM_VIEW = {
  length: 0,
  version: 0,
  timestampAt() {
    return NaN;
  },
  timestampGapBoundaries() {
    return [];
  },
  lastGapQueryStats() {
    return emptyGapQueryStats();
  },
  rowAt() {
    return undefined;
  },
};
