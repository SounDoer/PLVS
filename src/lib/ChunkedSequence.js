import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

function validatePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function chunkId(sequence, chunkRows) {
  return Math.floor(sequence / chunkRows);
}

function chunkOffset(sequence, chunkRows) {
  return sequence % chunkRows;
}

function createChunk(sequenceStart, chunkRows) {
  return {
    sequenceStart,
    rowCount: 0,
    sealed: false,
    values: new Array(chunkRows),
  };
}

function sealChunk(chunk) {
  chunk.sealed = true;
  Object.freeze(chunk.values);
  Object.freeze(chunk);
}

class SequenceView {
  at(index) {
    const found = this._valueLocation(index);
    return found ? found.chunk.values[found.offset] : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  timestampAt(index) {
    return this.at(index)?.timestampMs;
  }

  toArray() {
    return Array.from(this);
  }

  *[Symbol.iterator]() {
    for (let index = 0; index < this.length; index += 1) yield this.at(index);
  }
}

export class FrozenChunkedSequence extends SequenceView {
  constructor({
    chunks,
    startSequence,
    endSequence,
    chunkRows,
    sharedSealedChunks,
    copiedTailRows,
    copiedReferences,
  }) {
    super();
    this._chunks = chunks;
    this._startSequence = startSequence;
    this._endSequence = endSequence;
    this._chunkRows = chunkRows;
    this._firstChunkId = chunks.length > 0 ? chunkId(chunks[0].sequenceStart, this._chunkRows) : 0;
    this._sharedSealedChunks = sharedSealedChunks;
    this._copiedTailRows = copiedTailRows;
    this._copiedReferences = copiedReferences;
  }

  get length() {
    return this._endSequence - this._startSequence;
  }

  get version() {
    return 0;
  }

  get retainedStartSequence() {
    return this._startSequence;
  }

  get retainedEndSequence() {
    return this._endSequence;
  }

  _valueLocation(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return null;
    const sequence = this._startSequence + index;
    const chunk = this._chunks[chunkId(sequence, this._chunkRows) - this._firstChunkId];
    return chunk ? { chunk, offset: chunkOffset(sequence, this._chunkRows) } : null;
  }

  storageStats() {
    return {
      retainedRows: this.length,
      chunkCount: this._chunks.length,
      sharedSealedChunks: this._sharedSealedChunks,
      copiedTailRows: this._copiedTailRows,
      copiedReferences: this._copiedReferences,
    };
  }
}

export class ChunkedSequence extends SequenceView {
  constructor(capacity, { chunkRows = VISUAL_HISTORY_CHUNK_ROWS } = {}) {
    super();
    validatePositiveInteger(capacity, "ChunkedSequence capacity");
    validatePositiveInteger(chunkRows, "ChunkedSequence chunkRows");
    this._capacity = capacity;
    this._chunkRows = chunkRows;
    this._chunks = [];
    this._chunksOffset = 0;
    this._firstChunkId = 0;
    this._startSequence = 0;
    this._nextSequence = 0;
    this._version = 0;
  }

  get capacity() {
    return this._capacity;
  }

  get length() {
    return this._nextSequence - this._startSequence;
  }

  get version() {
    return this._version;
  }

  get retainedStartSequence() {
    return this._startSequence;
  }

  get retainedEndSequence() {
    return this._nextSequence;
  }

  push(value) {
    const sequence = this._nextSequence;
    let active = this._chunks[this._chunks.length - 1];
    if (!active || active.sealed) {
      active = createChunk(sequence, this._chunkRows);
      if (this._chunks.length === this._chunksOffset) {
        this._firstChunkId = chunkId(sequence, this._chunkRows);
      }
      this._chunks.push(active);
    }

    const offset = chunkOffset(sequence, this._chunkRows);
    active.values[offset] = value;
    active.rowCount += 1;
    this._nextSequence += 1;
    this._startSequence = Math.max(this._startSequence, this._nextSequence - this._capacity);
    if (active.rowCount === this._chunkRows) sealChunk(active);
    this._dropExpiredChunks();
    this._version += 1;
  }

  _valueLocation(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return null;
    const sequence = this._startSequence + index;
    const chunk =
      this._chunks[this._chunksOffset + chunkId(sequence, this._chunkRows) - this._firstChunkId];
    return chunk ? { chunk, offset: chunkOffset(sequence, this._chunkRows) } : null;
  }

  freeze() {
    const chunks = [];
    let sharedSealedChunks = 0;
    let copiedTailRows = 0;
    let copiedReferences = 0;

    for (let index = this._chunksOffset; index < this._chunks.length; index += 1) {
      const chunk = this._chunks[index];
      const chunkEnd = chunk.sequenceStart + chunk.rowCount;
      if (chunkEnd <= this._startSequence || chunk.sequenceStart >= this._nextSequence) continue;
      if (chunk.sealed) {
        chunks.push(chunk);
        sharedSealedChunks += 1;
        continue;
      }

      const copy = createChunk(chunk.sequenceStart, this._chunkRows);
      const copyStart = Math.max(chunk.sequenceStart, this._startSequence);
      const copyEnd = Math.min(chunkEnd, this._nextSequence);
      for (let sequence = copyStart; sequence < copyEnd; sequence += 1) {
        const offset = chunkOffset(sequence, this._chunkRows);
        copy.values[offset] = chunk.values[offset];
        copiedReferences += 1;
      }
      copy.rowCount = chunk.rowCount;
      sealChunk(copy);
      chunks.push(copy);
      copiedTailRows += copyEnd - copyStart;
    }

    return new FrozenChunkedSequence({
      chunks,
      startSequence: this._startSequence,
      endSequence: this._nextSequence,
      chunkRows: this._chunkRows,
      sharedSealedChunks,
      copiedTailRows,
      copiedReferences,
    });
  }

  clear() {
    this._chunks = [];
    this._chunksOffset = 0;
    const offset = chunkOffset(this._nextSequence, this._chunkRows);
    if (offset !== 0) this._nextSequence += this._chunkRows - offset;
    this._startSequence = this._nextSequence;
    this._firstChunkId = chunkId(this._nextSequence, this._chunkRows);
    this._version += 1;
  }

  storageStats() {
    return {
      retainedRows: this.length,
      chunkCount: this._chunks.length - this._chunksOffset,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedReferences: 0,
    };
  }

  _dropExpiredChunks() {
    while (
      this._chunksOffset < this._chunks.length &&
      this._chunks[this._chunksOffset].sequenceStart + this._chunks[this._chunksOffset].rowCount <=
        this._startSequence
    ) {
      this._chunks[this._chunksOffset] = undefined;
      this._chunksOffset += 1;
      this._firstChunkId += 1;
    }
    if (this._chunksOffset >= 1024 && this._chunksOffset * 2 >= this._chunks.length) {
      this._chunks = this._chunks.slice(this._chunksOffset);
      this._chunksOffset = 0;
    }
  }
}
