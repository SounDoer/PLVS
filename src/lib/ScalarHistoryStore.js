import { ChunkedSequence } from "./ChunkedSequence.js";
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";

function aggregateStats(views) {
  const columns = {};
  let sharedSealedChunks = 0;
  let copiedTailRows = 0;
  let copiedReferences = 0;
  for (const [name, view] of Object.entries(views)) {
    const stats = view.storageStats();
    columns[name] = stats;
    sharedSealedChunks += stats.sharedSealedChunks;
    copiedTailRows += stats.copiedTailRows;
    copiedReferences += stats.copiedReferences;
  }
  return { columns, sharedSealedChunks, copiedTailRows, copiedReferences };
}

class FrozenScalarHistory {
  constructor(loudness, audio, correlation) {
    this.loudness = loudness;
    this.audio = audio;
    this.correlation = correlation;
  }

  get length() {
    return this.loudness.length;
  }

  storageStats() {
    return aggregateStats({
      loudness: this.loudness,
      audio: this.audio,
      correlation: this.correlation,
    });
  }
}

export class ScalarHistoryStore {
  constructor(capacity, options) {
    // Loudness and audio do not take `options`: both slabs always use the shared history chunk
    // size, not a caller-supplied chunkRows, so neither will follow correlation if one is passed
    // here.
    this._loudness = new LoudnessHistorySlab(capacity);
    this._audio = new AudioSnapHistorySlab(capacity);
    this._correlation = new ChunkedSequence(capacity, options);
  }

  get capacity() {
    return this._loudness.capacity;
  }

  get length() {
    return this._loudness.length;
  }

  get loudness() {
    return this._loudness;
  }

  get audio() {
    return this._audio;
  }

  get correlation() {
    return this._correlation;
  }

  append({ loudness, audio, correlation }) {
    this._loudness.push(loudness);
    this._audio.push(audio, loudness?.timestampMs);
    this._correlation.push(correlation);
  }

  freeze() {
    return new FrozenScalarHistory(
      this._loudness.freeze(),
      this._audio.freeze(),
      this._correlation.freeze()
    );
  }

  clear() {
    this._loudness.clear();
    this._audio.clear();
    this._correlation.clear();
  }

  storageStats() {
    return aggregateStats({
      loudness: this._loudness,
      audio: this._audio,
      correlation: this._correlation,
    });
  }
}
