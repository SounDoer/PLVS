import { PowerOfTwoMinMaxIndex } from "../lib/PowerOfTwoMinMaxIndex.js";

const KEY_INDEX = Object.freeze({ m: 0, st: 1 });

function emptyBatchStats() {
  return {
    queries: 0,
    nodesVisited: 0,
    rawRowsVisited: 0,
    summaryBucketsVisited: 0,
  };
}

export class LoudnessHistoryIndex {
  constructor(capacityOrIndex, frozen = false) {
    this._index =
      typeof capacityOrIndex === "number"
        ? new PowerOfTwoMinMaxIndex(capacityOrIndex)
        : capacityOrIndex;
    this._frozen = frozen;
    this._batchQueryStats = emptyBatchStats();
  }

  append(row) {
    if (this._frozen) throw new TypeError("cannot append to a frozen LoudnessHistoryIndex");
    const sequence = this._index.retainedEndSequence;
    const values = [row.m, row.st];
    this._index.append(sequence, values, values);
  }

  queryRange(key, startSequence, endSequence, rawRowAt) {
    const valueIndex = KEY_INDEX[key];
    if (valueIndex === undefined) throw new TypeError(`unsupported loudness history key: ${key}`);
    const result = this.queryRangeValues(startSequence, endSequence, rawRowAt);
    return result
      ? {
          min: result.mins[valueIndex],
          max: result.maxes[valueIndex],
        }
      : null;
  }

  queryRangeValues(startSequence, endSequence, rawRowAt) {
    const result = this._index.queryRange(startSequence, endSequence, (sequence) => {
      const row = rawRowAt(sequence);
      if (!row) return row;
      const values = [row.m, row.st];
      return { mins: values, maxes: values };
    });
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
    return new LoudnessHistoryIndex(this._index.freeze(), true);
  }

  clear() {
    if (this._frozen) throw new TypeError("cannot clear a frozen LoudnessHistoryIndex");
    this._index.clear();
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

  get version() {
    return this._index.version;
  }
}
