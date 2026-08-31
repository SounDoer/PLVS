import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import {
  ChunkedHistorySlab,
  FrozenChunkedHistory,
  baseChunk,
  chunkOffsetForSequence,
} from "./ChunkedHistorySlab.js";
import { decodeNormalized, encodeNormalized } from "./packedHistoryCodecs.js";
import {
  POLAR_LEVEL_BIN_COUNT,
  accumulatePairSourceIntoBins,
  smoothPolarBins,
} from "../math/vectorscopePolarMath.js";

function mergeMax(target, source) {
  for (let index = 0; index < target.length; index += 1) {
    if (source[index] > target[index]) target[index] = source[index];
  }
}

function accumulatePackedPairs(chunk, row, pairValueCount, peak) {
  const offset = row * pairValueCount;
  accumulatePairSourceIntoBins(
    pairValueCount,
    (index) => Math.fround(decodeNormalized(chunk.pairs[offset + index]) ?? 0),
    peak,
    POLAR_LEVEL_BIN_COUNT
  );
}

function chunkSchema(pairValueCount) {
  return {
    name: "VectorscopeHistorySlab",
    createChunk: (sequenceStart) => ({
      ...baseChunk(sequenceStart),
      pairs: new Int16Array(VISUAL_HISTORY_CHUNK_ROWS * pairValueCount),
      polarMax: new Float64Array(POLAR_LEVEL_BIN_COUNT),
      correlation: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    }),
    cloneChunk: (chunk) => ({
      sequenceStart: chunk.sequenceStart,
      rowCount: chunk.rowCount,
      sealed: true,
      timestamps: chunk.timestamps.slice(0, chunk.rowCount),
      pairs: chunk.pairs.slice(0, chunk.rowCount * pairValueCount),
      polarMax: chunk.polarMax.slice(),
      correlation: chunk.correlation.slice(0, chunk.rowCount),
    }),
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength +
      chunk.pairs.byteLength +
      chunk.polarMax.byteLength +
      chunk.correlation.byteLength,
  };
}

function polarMaxHoldInChunks(
  chunks,
  retainedStartSequence,
  retainedEndSequence,
  index,
  pairValueCount
) {
  const length = retainedEndSequence - retainedStartSequence;
  if (index < 0 || index >= length) return null;
  const queryEndSequence = retainedStartSequence + index + 1;
  const peak = new Float64Array(POLAR_LEVEL_BIN_COUNT);

  for (const chunk of chunks) {
    const chunkEndSequence = chunk.sequenceStart + chunk.rowCount;
    const firstSequence = Math.max(retainedStartSequence, chunk.sequenceStart);
    const endSequence = Math.min(queryEndSequence, chunkEndSequence);
    if (firstSequence >= endSequence) continue;
    if (firstSequence === chunk.sequenceStart && endSequence === chunkEndSequence) {
      mergeMax(peak, chunk.polarMax);
      continue;
    }
    for (let sequence = firstSequence; sequence < endSequence; sequence += 1) {
      accumulatePackedPairs(chunk, chunkOffsetForSequence(sequence), pairValueCount, peak);
    }
  }
  return smoothPolarBins(peak);
}

function rowFrom(chunk, row, pairValueCount) {
  const offset = row * pairValueCount;
  const packedPairs = chunk.pairs.subarray(offset, offset + pairValueCount);
  let pairs;
  return {
    packedPairs,
    get pairs() {
      pairs ??= Float32Array.from(packedPairs, (value) => decodeNormalized(value) ?? 0);
      return pairs;
    },
    pairAt(index) {
      return index >= 0 && index < pairValueCount
        ? decodeNormalized(packedPairs[index])
        : undefined;
    },
    correlation: chunk.correlation[row],
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

export class VectorscopeHistorySlab extends ChunkedHistorySlab {
  constructor(capacity, pairValueCount) {
    if (pairValueCount <= 0) {
      throw new RangeError("VectorscopeHistorySlab pairValueCount must be > 0");
    }
    super(capacity, chunkSchema(pairValueCount));
    this._pairValueCount = pairValueCount;
  }

  get pairValueCount() {
    return this._pairValueCount;
  }

  get polarBinCount() {
    return POLAR_LEVEL_BIN_COUNT;
  }

  matchesPairValueCount(pairValueCount) {
    return this._pairValueCount === pairValueCount;
  }

  push({ pairs, correlation, timestampMs }) {
    if (!pairs?.length) return;
    if (!this.matchesPairValueCount(pairs.length)) {
      throw new RangeError("VectorscopeHistorySlab cannot store rows with a different pair count");
    }

    this.appendRow(timestampMs, (chunk, row) => {
      const offset = row * this._pairValueCount;
      for (let index = 0; index < this._pairValueCount; index += 1) {
        chunk.pairs[offset + index] = encodeNormalized(pairs[index]);
      }
      accumulatePackedPairs(chunk, row, this._pairValueCount, chunk.polarMax);
      chunk.correlation[row] = Number.isFinite(correlation) ? correlation : -Infinity;
    });
  }

  at(index, { copyRows = false } = {}) {
    const found = this.chunkAt(index);
    if (!found) return undefined;
    return rowFrom(found.chunk, found.row, this._pairValueCount, copyRows);
  }

  rowAt(index, options) {
    return this.at(index, options);
  }

  polarMaxHoldAt(index) {
    return polarMaxHoldInChunks(
      this._chunks,
      this._startSequence,
      this._nextSequence,
      index,
      this._pairValueCount
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
    return new FrozenVectorscopeHistory({
      pairValueCount: this._pairValueCount,
      ...this.freezeChunks(),
    });
  }

  storageStats() {
    return packedStorageStats(super.storageStats());
  }
}

export class FrozenVectorscopeHistory extends FrozenChunkedHistory {
  constructor({ pairValueCount, ...storage }) {
    super(storage);
    this._pairValueCount = pairValueCount;
  }

  get polarBinCount() {
    return POLAR_LEVEL_BIN_COUNT;
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    if (!found) return undefined;
    return rowFrom(found.chunk, found.row, this._pairValueCount, false);
  }

  polarMaxHoldAt(index) {
    return polarMaxHoldInChunks(
      this._chunks,
      this._startSequence,
      this._endSequence,
      index,
      this._pairValueCount
    );
  }

  storageStats() {
    return packedStorageStats(super.storageStats());
  }
}
