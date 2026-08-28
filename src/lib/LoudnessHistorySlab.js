import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

// 19 sub-blocks per 100 ms tick at 48 kHz, times 2 channels, times min/max: a starting guess,
// not a limit -- RaggedFloatColumn grows past it.
const SUB_PAIR_VALUES_PER_ROW = 19 * 2 * 2;

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  chunk.m = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.st = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.waveformMin = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.waveformMax = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.waveformSubPairs = new RaggedFloatColumn(
    VISUAL_HISTORY_CHUNK_ROWS,
    SUB_PAIR_VALUES_PER_ROW
  );
  return chunk;
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    m: chunk.m.slice(0, chunk.rowCount),
    st: chunk.st.slice(0, chunk.rowCount),
    waveformMin: chunk.waveformMin.clone(),
    waveformMax: chunk.waveformMax.clone(),
    waveformSubPairs: chunk.waveformSubPairs.clone(),
  };
}

function payloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.m.byteLength +
    chunk.st.byteLength +
    chunk.waveformMin.byteLength +
    chunk.waveformMax.byteLength +
    chunk.waveformSubPairs.byteLength
  );
}

const SCHEMA = { name: "LoudnessHistorySlab", createChunk, cloneChunk, payloadBytes };

/**
 * Sub-blocks are stored flat at stride 2 * channelCount, and the channel count is whatever this
 * row's extrema carried, so the count is derived rather than stored.
 */
function subCountFrom(chunk, row) {
  const channels = chunk.waveformMin.lengthAt(row) || chunk.waveformMax.lengthAt(row);
  if (channels === 0) return 0;
  return Math.floor(chunk.waveformSubPairs.lengthAt(row) / (2 * channels));
}

function rowFrom(chunk, row) {
  return {
    m: chunk.m[row],
    st: chunk.st[row],
    timestampMs: chunk.timestamps[row],
    waveformMin: chunk.waveformMin.at(row),
    waveformMax: chunk.waveformMax.at(row),
    waveformSubPairs: chunk.waveformSubPairs.at(row),
    waveformSubCount: subCountFrom(chunk, row),
  };
}

function readValue(view, index, key) {
  const found = view.chunkAt(index);
  if (!found) return undefined;
  return found.chunk[key]?.[found.row];
}

/** Packed storage for the loudness column of the scalar history. */
export class LoudnessHistorySlab extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  push(row) {
    this.appendRow(row?.timestampMs, (chunk, index) => {
      chunk.m[index] = typeof row?.m === "number" ? row.m : -Infinity;
      chunk.st[index] = typeof row?.st === "number" ? row.st : -Infinity;
      chunk.waveformMin.append(row?.waveformMin);
      chunk.waveformMax.append(row?.waveformMax);
      chunk.waveformSubPairs.append(row?.waveformSubPairs);
    });
  }

  /** One loudness value, for hot paths that would otherwise materialise a whole row. */
  valueAt(index, key) {
    return readValue(this, index, key);
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  freeze() {
    return new FrozenLoudnessHistory(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenLoudnessHistory extends FrozenChunkedHistory {
  valueAt(index, key) {
    return readValue(this, index, key);
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  at(index) {
    return this.rowAt(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
