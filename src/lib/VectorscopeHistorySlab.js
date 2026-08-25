import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";

function chunkSchema(pairValueCount) {
  return {
    name: "VectorscopeHistorySlab",
    createChunk: (sequenceStart) => ({
      ...baseChunk(sequenceStart),
      pairs: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * pairValueCount),
      correlation: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
      sideToMidDb: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
      midEnergy: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
      sideEnergy: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    }),
    cloneChunk: (chunk) => ({
      sequenceStart: chunk.sequenceStart,
      rowCount: chunk.rowCount,
      sealed: true,
      timestamps: chunk.timestamps.slice(),
      pairs: chunk.pairs.slice(),
      correlation: chunk.correlation.slice(),
      sideToMidDb: chunk.sideToMidDb.slice(),
      midEnergy: chunk.midEnergy.slice(),
      sideEnergy: chunk.sideEnergy.slice(),
    }),
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength +
      chunk.pairs.byteLength +
      chunk.correlation.byteLength +
      chunk.sideToMidDb.byteLength +
      chunk.midEnergy.byteLength +
      chunk.sideEnergy.byteLength,
  };
}

function rowFrom(chunk, row, pairValueCount, copyRows) {
  const offset = row * pairValueCount;
  const pairs = chunk.pairs.subarray(offset, offset + pairValueCount);
  return {
    pairs: copyRows ? Float32Array.from(pairs) : pairs,
    correlation: chunk.correlation[row],
    sideToMidDb: chunk.sideToMidDb[row],
    midEnergy: chunk.midEnergy[row],
    sideEnergy: chunk.sideEnergy[row],
    timestampMs: chunk.timestamps[row],
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

  matchesPairValueCount(pairValueCount) {
    return this._pairValueCount === pairValueCount;
  }

  push({ pairs, correlation, sideToMidDb, midEnergy, sideEnergy, timestampMs }) {
    if (!pairs?.length) return;
    if (!this.matchesPairValueCount(pairs.length)) {
      throw new RangeError("VectorscopeHistorySlab cannot store rows with a different pair count");
    }

    this.appendRow(timestampMs, (chunk, row) => {
      chunk.pairs.set(pairs, row * this._pairValueCount);
      chunk.correlation[row] = Number.isFinite(correlation) ? correlation : -Infinity;
      chunk.sideToMidDb[row] = Number.isFinite(sideToMidDb) ? sideToMidDb : -Infinity;
      chunk.midEnergy[row] = Number.isFinite(midEnergy) ? midEnergy : 0;
      chunk.sideEnergy[row] = Number.isFinite(sideEnergy) ? sideEnergy : 0;
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
}

export class FrozenVectorscopeHistory extends FrozenChunkedHistory {
  constructor({ pairValueCount, ...storage }) {
    super(storage);
    this._pairValueCount = pairValueCount;
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    if (!found) return undefined;
    return rowFrom(found.chunk, found.row, this._pairValueCount, false);
  }
}
