import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  chunk.mins = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.maxes = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  return chunk;
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    mins: chunk.mins.clone(),
    maxes: chunk.maxes.clone(),
  };
}

const SCHEMA = {
  name: "MinMaxRowStore",
  createChunk,
  cloneChunk,
  payloadBytes: (chunk) =>
    chunk.timestamps.byteLength + chunk.mins.byteLength + chunk.maxes.byteLength,
};

function rowFrom(chunk, row) {
  return { mins: chunk.mins.at(row), maxes: chunk.maxes.at(row) };
}

/**
 * The per-row extrema a min/max index falls back to when no summary bucket covers a sequence.
 *
 * Stored packed rather than as one `{ mins, maxes }` object per row: at four-hour retention that
 * was three JavaScript objects per row for data the loudness column already holds, and mark-compact
 * pause time scales with how many objects are alive.
 */
export class MinMaxRowStore extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  push(row) {
    // A raw-row store has no clock of its own; the base slab's timestamp column stays unused.
    this.appendRow(Number.NaN, (chunk) => {
      chunk.mins.append(row?.mins);
      chunk.maxes.append(row?.maxes);
    });
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  freeze() {
    return new FrozenMinMaxRowStore(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenMinMaxRowStore extends FrozenChunkedHistory {
  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
