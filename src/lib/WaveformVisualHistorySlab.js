import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";

const FIELDS = [
  "waveformMin",
  "waveformMax",
  "dominantFrequencyHz",
  "spectralCentroidHz",
  "tonality",
];

function schema(channelCount) {
  return {
    name: "WaveformVisualHistorySlab",
    createChunk: (sequenceStart) => {
      const chunk = baseChunk(sequenceStart);
      for (const field of FIELDS) {
        chunk[field] = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * channelCount);
      }
      return chunk;
    },
    cloneChunk: (chunk) => {
      const copy = {
        sequenceStart: chunk.sequenceStart,
        rowCount: chunk.rowCount,
        sealed: true,
        timestamps: chunk.timestamps.slice(0, chunk.rowCount),
      };
      for (const field of FIELDS) {
        copy[field] = chunk[field].slice(0, chunk.rowCount * channelCount);
      }
      return copy;
    },
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength +
      FIELDS.reduce((total, field) => total + chunk[field].byteLength, 0),
  };
}

function rowFrom(chunk, row, channelCount) {
  const first = row * channelCount;
  const last = first + channelCount;
  const result = { timestampMs: chunk.timestamps[row] };
  for (const field of FIELDS) result[field] = chunk[field].subarray(first, last);
  return result;
}

function detailedStats(base, channelCount) {
  return { ...base, channelCount, valueArrayType: "Float32Array" };
}

export class WaveformVisualHistorySlab extends ChunkedHistorySlab {
  constructor(capacity, channelCount) {
    if (!Number.isInteger(channelCount) || channelCount < 0) {
      throw new RangeError("WaveformVisualHistorySlab channelCount must be non-negative");
    }
    super(capacity, schema(channelCount));
    this._channelCount = channelCount;
  }

  get channelCount() {
    return this._channelCount;
  }

  push(value) {
    this.appendRow(value?.timestampMs, (chunk, row) => {
      const first = row * this._channelCount;
      for (const field of FIELDS) {
        const source = value?.[field];
        for (let channel = 0; channel < this._channelCount; channel += 1) {
          chunk[field][first + channel] = Number.isFinite(source?.[channel]) ? source[channel] : 0;
        }
      }
    });
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row, this._channelCount) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  freeze() {
    return new FrozenWaveformVisualHistory({
      channelCount: this._channelCount,
      ...this.freezeChunks(),
    });
  }

  storageStats() {
    return detailedStats(super.storageStats(), this._channelCount);
  }
}

export class FrozenWaveformVisualHistory extends FrozenChunkedHistory {
  constructor({ channelCount, ...storage }) {
    super(storage);
    this._channelCount = channelCount;
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row, this._channelCount) : undefined;
  }

  at(index) {
    return this.rowAt(index);
  }

  storageStats() {
    return detailedStats(super.storageStats(), this._channelCount);
  }
}
