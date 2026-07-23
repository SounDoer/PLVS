import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import {
  chunkIdForSequence,
  chunkOffsetForSequence,
  findChunkForSequence,
} from "./historyChunkMath.js";

function createChunk(sequenceStart, pairValueCount) {
  return {
    sequenceStart,
    rowCount: 0,
    sealed: false,
    timestamps: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    pairs: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * pairValueCount),
    correlation: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    sideToMidDb: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    midEnergy: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    sideEnergy: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
  };
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(),
    pairs: chunk.pairs.slice(),
    correlation: chunk.correlation.slice(),
    sideToMidDb: chunk.sideToMidDb.slice(),
    midEnergy: chunk.midEnergy.slice(),
    sideEnergy: chunk.sideEnergy.slice(),
  };
}

function chunkPayloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.pairs.byteLength +
    chunk.correlation.byteLength +
    chunk.sideToMidDb.byteLength +
    chunk.midEnergy.byteLength +
    chunk.sideEnergy.byteLength
  );
}

function rowFromChunk(chunk, sequence, pairValueCount, copyRows) {
  const row = chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
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

export class VectorscopeHistorySlab {
  constructor(capacity, pairValueCount) {
    if (capacity <= 0) throw new RangeError("VectorscopeHistorySlab capacity must be > 0");
    if (pairValueCount <= 0) {
      throw new RangeError("VectorscopeHistorySlab pairValueCount must be > 0");
    }
    this._cap = capacity;
    this._pairValueCount = pairValueCount;
    this._chunks = [];
    this._firstChunkId = 0;
    this._startSequence = 0;
    this._nextSequence = 0;
    this._version = 0;
  }

  get capacity() {
    return this._cap;
  }

  get length() {
    return this._nextSequence - this._startSequence;
  }

  get pairValueCount() {
    return this._pairValueCount;
  }

  get version() {
    return this._version;
  }

  timestampAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return NaN;
    const chunk = this._chunkForSequence(sequence);
    return chunk.timestamps[chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS)];
  }

  matchesPairValueCount(pairValueCount) {
    return this._pairValueCount === pairValueCount;
  }

  push({ pairs, correlation, sideToMidDb, midEnergy, sideEnergy, timestampMs }) {
    if (!pairs?.length) return;
    if (!this.matchesPairValueCount(pairs.length)) {
      throw new RangeError("VectorscopeHistorySlab cannot store rows with a different pair count");
    }

    const sequence = this._nextSequence;
    let active = this._chunks[this._chunks.length - 1];
    if (!active || active.sealed) {
      active = createChunk(sequence, this._pairValueCount);
      if (this._chunks.length === 0) {
        this._firstChunkId = chunkIdForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
      }
      this._chunks.push(active);
    }

    const row = chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
    const offset = row * this._pairValueCount;
    active.timestamps[row] = Number.isFinite(timestampMs) ? timestampMs : -Infinity;
    active.pairs.set(pairs, offset);
    active.correlation[row] = Number.isFinite(correlation) ? correlation : -Infinity;
    active.sideToMidDb[row] = Number.isFinite(sideToMidDb) ? sideToMidDb : -Infinity;
    active.midEnergy[row] = Number.isFinite(midEnergy) ? midEnergy : 0;
    active.sideEnergy[row] = Number.isFinite(sideEnergy) ? sideEnergy : 0;
    active.rowCount += 1;
    active.sealed = active.rowCount === VISUAL_HISTORY_CHUNK_ROWS;
    this._nextSequence += 1;
    this._startSequence = Math.max(this._startSequence, this._nextSequence - this._cap);
    this._dropExpiredChunks();
    this._version += 1;
  }

  at(index, { copyRows = false } = {}) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return undefined;
    return rowFromChunk(this._chunkForSequence(sequence), sequence, this._pairValueCount, copyRows);
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
    const startSequence = this._startSequence;
    const endSequence = this._nextSequence;
    const chunks = [];
    let sharedSealedChunks = 0;
    let copiedTailRows = 0;
    let copiedTailBytes = 0;

    for (const chunk of this._chunks) {
      const chunkEnd = chunk.sequenceStart + chunk.rowCount;
      if (chunkEnd <= startSequence || chunk.sequenceStart >= endSequence) continue;
      if (chunk.sealed) {
        chunks.push(chunk);
        sharedSealedChunks += 1;
      } else {
        const copied = cloneChunk(chunk);
        chunks.push(copied);
        copiedTailRows =
          Math.min(chunkEnd, endSequence) - Math.max(chunk.sequenceStart, startSequence);
        copiedTailBytes = chunkPayloadBytes(copied);
      }
    }

    return new FrozenVectorscopeHistory({
      pairValueCount: this._pairValueCount,
      chunks,
      startSequence,
      endSequence,
      sharedSealedChunks,
      copiedTailRows,
      copiedTailBytes,
    });
  }

  clear() {
    this._chunks = [];
    const offset = chunkOffsetForSequence(this._nextSequence, VISUAL_HISTORY_CHUNK_ROWS);
    if (offset !== 0) this._nextSequence += VISUAL_HISTORY_CHUNK_ROWS - offset;
    this._startSequence = this._nextSequence;
    this._firstChunkId = chunkIdForSequence(this._nextSequence, VISUAL_HISTORY_CHUNK_ROWS);
  }

  storageStats() {
    return {
      chunkCount: this._chunks.length,
      retainedRows: this.length,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    };
  }

  _sequenceAt(index) {
    if (index < 0 || index >= this.length) return null;
    return this._startSequence + index;
  }

  _chunkForSequence(sequence) {
    return findChunkForSequence(
      this._chunks,
      this._firstChunkId,
      sequence,
      VISUAL_HISTORY_CHUNK_ROWS
    );
  }

  _dropExpiredChunks() {
    while (
      this._chunks.length > 0 &&
      this._chunks[0].sequenceStart + this._chunks[0].rowCount <= this._startSequence
    ) {
      this._chunks.shift();
      this._firstChunkId += 1;
    }
  }
}

export class FrozenVectorscopeHistory {
  constructor({
    pairValueCount,
    chunks,
    startSequence,
    endSequence,
    sharedSealedChunks,
    copiedTailRows,
    copiedTailBytes,
  }) {
    this._pairValueCount = pairValueCount;
    this._chunks = chunks;
    this._startSequence = startSequence;
    this._endSequence = endSequence;
    this._firstChunkId =
      chunks.length > 0
        ? chunkIdForSequence(chunks[0].sequenceStart, VISUAL_HISTORY_CHUNK_ROWS)
        : 0;
    this._sharedSealedChunks = sharedSealedChunks;
    this._copiedTailRows = copiedTailRows;
    this._copiedTailBytes = copiedTailBytes;
  }

  get length() {
    return this._endSequence - this._startSequence;
  }

  get version() {
    return 0;
  }

  timestampAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return NaN;
    const chunk = this._chunkForSequence(sequence);
    return chunk.timestamps[chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS)];
  }

  rowAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return undefined;
    return rowFromChunk(this._chunkForSequence(sequence), sequence, this._pairValueCount, false);
  }

  storageStats() {
    return {
      chunkCount: this._chunks.length,
      retainedRows: this.length,
      sharedSealedChunks: this._sharedSealedChunks,
      copiedTailRows: this._copiedTailRows,
      copiedTailBytes: this._copiedTailBytes,
    };
  }

  _sequenceAt(index) {
    if (index < 0 || index >= this.length) return null;
    return this._startSequence + index;
  }

  _chunkForSequence(sequence) {
    return findChunkForSequence(
      this._chunks,
      this._firstChunkId,
      sequence,
      VISUAL_HISTORY_CHUNK_ROWS
    );
  }
}
