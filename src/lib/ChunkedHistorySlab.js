import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

/**
 * Chunked storage for a visual history: rows arrive one at a time, the oldest ones expire, and a
 * snapshot can be taken without copying what will never change again.
 *
 * A metric supplies a chunk schema -- how to allocate a chunk of rows, how to copy one, and how
 * many bytes it holds -- and writes its own fields into a row. Everything about *where* a row
 * lives belongs here: the running sequence number, which chunk holds it, sealing a full chunk,
 * dropping chunks that have fallen out of the retention window, and freezing.
 *
 * Rows are addressed by a monotonic sequence number rather than an array index, so expiry never
 * moves a stored row: dropping the oldest chunk changes where the window starts, not where any
 * surviving row sits. Index 0 is whatever the window currently starts at.
 */
export class ChunkedHistorySlab {
  /**
   * @param {number} capacity retained row count; older rows expire
   * @param {{
   *   name: string,
   *   createChunk: (sequenceStart: number) => object,
   *   cloneChunk: (chunk: object) => object,
   *   payloadBytes: (chunk: object) => number,
   * }} schema
   */
  constructor(capacity, schema) {
    if (capacity <= 0) throw new RangeError(`${schema.name} capacity must be > 0`);
    this._schema = schema;
    this._cap = capacity;
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

  /** Bumped on every appended row, so a consumer can tell "unchanged" from "same length". */
  get version() {
    return this._version;
  }

  /** The stored timestamp, which is -Infinity for a row that arrived without a usable one. */
  timestampAt(index) {
    const found = this.chunkAt(index);
    if (!found) return NaN;
    return found.chunk.timestamps[found.row];
  }

  /**
   * Appends one row. `writeRow(chunk, row)` fills in the metric's own fields; the timestamp and
   * all the bookkeeping around it are written here.
   */
  appendRow(timestampMs, writeRow) {
    const sequence = this._nextSequence;
    let active = this._chunks[this._chunks.length - 1];
    if (!active || active.sealed) {
      active = this._schema.createChunk(sequence);
      if (this._chunks.length === 0) this._firstChunkId = chunkIdForSequence(sequence);
      this._chunks.push(active);
    }

    const row = chunkOffsetForSequence(sequence);
    active.timestamps[row] = Number.isFinite(timestampMs) ? timestampMs : -Infinity;
    writeRow(active, row);
    active.rowCount += 1;
    active.sealed = active.rowCount === VISUAL_HISTORY_CHUNK_ROWS;
    this._nextSequence += 1;
    this._startSequence = Math.max(this._startSequence, this._nextSequence - this._cap);
    this._dropExpiredChunks();
    this._version += 1;
  }

  /** Locates a retained row: the chunk holding it and its offset inside that chunk. */
  chunkAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return null;
    return { chunk: this._chunkForSequence(sequence), row: chunkOffsetForSequence(sequence) };
  }

  /**
   * The chunks a snapshot needs, with the accounting a caller reports through storageStats.
   * Sealed chunks are shared rather than copied -- they can no longer change -- so only the one
   * chunk still being written into is duplicated.
   */
  freezeChunks() {
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
        const copied = this._schema.cloneChunk(chunk);
        chunks.push(copied);
        copiedTailRows =
          Math.min(chunkEnd, endSequence) - Math.max(chunk.sequenceStart, startSequence);
        copiedTailBytes = this._schema.payloadBytes(copied);
      }
    }

    return {
      chunks,
      startSequence,
      endSequence,
      sharedSealedChunks,
      copiedTailRows,
      copiedTailBytes,
    };
  }

  /**
   * Drops every row. The sequence counter jumps to the next chunk boundary rather than resetting,
   * so a snapshot taken before the clear keeps addressing its own rows unambiguously.
   */
  clear() {
    this._chunks = [];
    const offset = chunkOffsetForSequence(this._nextSequence);
    if (offset !== 0) this._nextSequence += VISUAL_HISTORY_CHUNK_ROWS - offset;
    this._startSequence = this._nextSequence;
    this._firstChunkId = chunkIdForSequence(this._nextSequence);
  }

  /** A live slab shares nothing and copies nothing; the counts exist for parity with a snapshot. */
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
    return this._chunks[chunkIdForSequence(sequence) - this._firstChunkId];
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

/**
 * The read-only half of the same storage: the chunks a freeze selected, addressed the same way.
 * A metric adds its own row reader on top.
 */
export class FrozenChunkedHistory {
  constructor({
    chunks,
    startSequence,
    endSequence,
    sharedSealedChunks,
    copiedTailRows,
    copiedTailBytes,
  }) {
    this._chunks = chunks;
    this._startSequence = startSequence;
    this._endSequence = endSequence;
    this._firstChunkId = chunks.length > 0 ? chunkIdForSequence(chunks[0].sequenceStart) : 0;
    this._sharedSealedChunks = sharedSealedChunks;
    this._copiedTailRows = copiedTailRows;
    this._copiedTailBytes = copiedTailBytes;
  }

  get length() {
    return this._endSequence - this._startSequence;
  }

  /** A snapshot never changes, so its version is a constant. */
  get version() {
    return 0;
  }

  timestampAt(index) {
    const found = this.chunkAt(index);
    if (!found) return NaN;
    return found.chunk.timestamps[found.row];
  }

  chunkAt(index) {
    if (index < 0 || index >= this.length) return null;
    const sequence = this._startSequence + index;
    return {
      chunk: this._chunks[chunkIdForSequence(sequence) - this._firstChunkId],
      row: chunkOffsetForSequence(sequence),
    };
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
}

export function chunkIdForSequence(sequence) {
  return Math.floor(sequence / VISUAL_HISTORY_CHUNK_ROWS);
}

export function chunkOffsetForSequence(sequence) {
  return sequence % VISUAL_HISTORY_CHUNK_ROWS;
}

/** The per-chunk fields the core owns; a schema spreads this into its own chunk shape. */
export function baseChunk(sequenceStart) {
  return {
    sequenceStart,
    rowCount: 0,
    sealed: false,
    timestamps: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
  };
}
