import { PowerOfTwoMinMaxIndex } from "../lib/PowerOfTwoMinMaxIndex.js";
import { RingBuffer } from "../lib/RingBuffer.js";

function emptyBatchStats() {
  return {
    queries: 0,
    nodesVisited: 0,
    rawRowsVisited: 0,
    summaryBucketsVisited: 0,
  };
}

function valuesFromRow(row) {
  const valueCount = Math.max(row.waveformMin?.length ?? 0, row.waveformMax?.length ?? 0);
  return {
    mins: Array.from({ length: valueCount }, (_, channel) => row.waveformMin?.[channel] ?? 0),
    maxes: Array.from({ length: valueCount }, (_, channel) => row.waveformMax?.[channel] ?? 0),
  };
}

export class WaveformHistoryIndex {
  constructor(capacityOrIndex, frozen = false, rawRows = null) {
    this._index =
      typeof capacityOrIndex === "number"
        ? new PowerOfTwoMinMaxIndex(capacityOrIndex)
        : capacityOrIndex;
    this._frozen = frozen;
    this._rawRows = rawRows ?? new RingBuffer(capacityOrIndex);
    this._batchQueryStats = emptyBatchStats();
  }

  append(row) {
    if (this._frozen) throw new TypeError("cannot append to a frozen WaveformHistoryIndex");
    const { mins, maxes } = valuesFromRow(row);
    this._index.append(this._index.retainedEndSequence, mins, maxes);
    this._rawRows.push({ mins, maxes });
  }

  queryRange(startSequence, endSequence) {
    const retainedStart = this._index.retainedStartSequence;
    const result = this._index.queryRange(startSequence, endSequence, (sequence) =>
      typeof this._rawRows.at === "function"
        ? this._rawRows.at(sequence - retainedStart)
        : this._rawRows[sequence - retainedStart]
    );
    const stats = this._index.lastQueryStats();
    this._batchQueryStats.queries += 1;
    this._batchQueryStats.nodesVisited += stats.nodesVisited;
    this._batchQueryStats.rawRowsVisited += stats.rawRowsVisited;
    this._batchQueryStats.summaryBucketsVisited += stats.summaryBucketsVisited;
    return result;
  }

  beginQueryBatch() {
    this._batchQueryStats = emptyBatchStats();
  }

  lastQueryStats() {
    return this._index.lastQueryStats();
  }

  batchQueryStats() {
    return { ...this._batchQueryStats };
  }

  freeze() {
    return new WaveformHistoryIndex(
      this._index.freeze(),
      true,
      Object.freeze(this._rawRows.toArray())
    );
  }

  clear() {
    if (this._frozen) throw new TypeError("cannot clear a frozen WaveformHistoryIndex");
    this._index.clear();
    this._rawRows.clear();
    this.beginQueryBatch();
  }

  get capacity() {
    return this._index.capacity;
  }

  get retainedStartSequence() {
    return this._index.retainedStartSequence;
  }

  get retainedEndSequence() {
    return this._index.retainedEndSequence;
  }

  get valueCount() {
    return this._index.valueCount;
  }

  get version() {
    return this._index.version;
  }
}
