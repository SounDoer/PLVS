import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import {
  chunkIdForSequence,
  chunkOffsetForSequence,
  findChunkForSequence,
} from "./historyChunkMath.js";

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
    target[offset + i] = Number.isFinite(values?.[i]) ? values[i] : -Infinity;
  }
}

function copySecondaryRow(target, offset, bandCount, values) {
  for (let i = 0; i < bandCount; i += 1) {
    target[offset + i] = Number.isFinite(values?.[i]) ? values[i] : NaN;
  }
}

function createChunk(sequenceStart, bands, bandCount) {
  return {
    sequenceStart,
    rowCapacity: VISUAL_HISTORY_CHUNK_ROWS,
    rowCount: 0,
    sealed: false,
    bands,
    timestamps: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    dbA: new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
    dbB: null,
    hasB: null,
  };
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCapacity: chunk.rowCapacity,
    rowCount: chunk.rowCount,
    sealed: true,
    bands: chunk.bands,
    timestamps: chunk.timestamps.slice(),
    dbA: chunk.dbA.slice(),
    dbB: chunk.dbB?.slice() ?? null,
    hasB: chunk.hasB?.slice() ?? null,
  };
}

function chunkPayloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.dbA.byteLength +
    (chunk.dbB?.byteLength ?? 0) +
    (chunk.hasB?.byteLength ?? 0)
  );
}

function rowFromChunk(chunk, sequence, bandCount, bands, copyRows) {
  const row = chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
  const offset = row * bandCount;
  const dbList = chunk.dbA.subarray(offset, offset + bandCount);
  const dbListB =
    chunk.dbB && chunk.hasB?.[row] ? chunk.dbB.subarray(offset, offset + bandCount) : EMPTY_F32;
  return {
    bands,
    dbList: copyRows ? Float32Array.from(dbList) : dbList,
    dbListB: copyRows && dbListB.length ? Float32Array.from(dbListB) : dbListB,
    timestampMs: chunk.timestamps[row],
  };
}

export class SpectrumHistorySlab {
  constructor(capacity, bands) {
    if (capacity <= 0) throw new RangeError("SpectrumHistorySlab capacity must be > 0");
    this._cap = capacity;
    this._bands = bands ?? [];
    this._bandCount = this._bands.length;
    this._chunks = [];
    this._firstChunkId = 0;
    this._startSequence = 0;
    this._nextSequence = 0;
    this._version = 0;
    this._hasSecondary = false;
  }

  get capacity() {
    return this._cap;
  }

  get length() {
    return this._nextSequence - this._startSequence;
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

  get version() {
    return this._version;
  }

  timestampAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return NaN;
    const chunk = this._chunkForSequence(sequence);
    return chunk.timestamps[chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS)];
  }

  rowAt(index) {
    return this.at(index);
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

    return new FrozenSpectrumHistory({
      bands: this._bands,
      bandCount: this._bandCount,
      chunks,
      startSequence,
      endSequence,
      sharedSealedChunks,
      copiedTailRows,
      copiedTailBytes,
    });
  }

  matchesBands(bands) {
    return sameBands(this._bands, bands ?? []);
  }

  push({ bands, dbList, dbListB, timestampMs }) {
    if (!this.matchesBands(bands)) {
      throw new RangeError("SpectrumHistorySlab cannot store rows with a different band grid");
    }
    const sequence = this._nextSequence;
    let active = this._chunks[this._chunks.length - 1];
    if (!active || active.sealed) {
      active = createChunk(sequence, this._bands, this._bandCount);
      if (this._chunks.length === 0) {
        this._firstChunkId = chunkIdForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
      }
      this._chunks.push(active);
    }

    const row = chunkOffsetForSequence(sequence, VISUAL_HISTORY_CHUNK_ROWS);
    const offset = row * this._bandCount;
    active.timestamps[row] = Number.isFinite(timestampMs) ? timestampMs : -Infinity;
    copyPrimaryRow(active.dbA, offset, this._bandCount, dbList);

    if (dbListB?.length) {
      if (!active.dbB) {
        active.dbB = new Float32Array(active.rowCapacity * this._bandCount);
        active.hasB = new Uint8Array(active.rowCapacity);
      }
      copySecondaryRow(active.dbB, offset, this._bandCount, dbListB);
      active.hasB[row] = 1;
      this._hasSecondary = true;
    }

    active.rowCount += 1;
    active.sealed = active.rowCount === active.rowCapacity;
    this._nextSequence += 1;
    this._startSequence = Math.max(this._startSequence, this._nextSequence - this._cap);
    this._dropExpiredChunks();
    this._version += 1;
  }

  at(index, { copyRows = false } = {}) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return undefined;
    return rowFromChunk(
      this._chunkForSequence(sequence),
      sequence,
      this._bandCount,
      this._bands,
      copyRows
    );
  }

  toArray(options) {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i += 1) {
      out[i] = this.at(i, options);
    }
    return out;
  }

  clear() {
    this._chunks = [];
    const offset = chunkOffsetForSequence(this._nextSequence, VISUAL_HISTORY_CHUNK_ROWS);
    if (offset !== 0) this._nextSequence += VISUAL_HISTORY_CHUNK_ROWS - offset;
    this._startSequence = this._nextSequence;
    this._firstChunkId = chunkIdForSequence(this._nextSequence, VISUAL_HISTORY_CHUNK_ROWS);
    this._hasSecondary = false;
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

export class FrozenSpectrumHistory {
  constructor({
    bands,
    bandCount,
    chunks,
    startSequence,
    endSequence,
    sharedSealedChunks,
    copiedTailRows,
    copiedTailBytes,
  }) {
    this._bands = bands ?? [];
    this._bandCount = bandCount;
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
    return rowFromChunk(
      this._chunkForSequence(sequence),
      sequence,
      this._bandCount,
      this._bands,
      false
    );
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

export const EMPTY_SPECTRUM_VIEW = {
  length: 0,
  version: 0,
  timestampAt() {
    return NaN;
  },
  rowAt() {
    return undefined;
  },
};
