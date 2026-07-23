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

function rowHasNaN(row) {
  for (const values of [row.waveformMin, row.waveformMax]) {
    if (!values) continue;
    for (let index = 0; index < values.length; index += 1) {
      if (Number.isNaN(values[index])) return true;
    }
  }
  return false;
}

function sequenceAt(sequences, index) {
  return typeof sequences.at === "function" ? sequences.at(index) : sequences[index];
}

function lowerBound(sequences, target) {
  let low = 0;
  let high = sequences.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (sequenceAt(sequences, middle) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class WaveformHistoryIndex {
  constructor(capacityOrIndex, frozen = false, rawRows = null, nanSequences = null) {
    this._index =
      typeof capacityOrIndex === "number"
        ? new PowerOfTwoMinMaxIndex(capacityOrIndex)
        : capacityOrIndex;
    this._frozen = frozen;
    this._rawRows = rawRows ?? new RingBuffer(capacityOrIndex);
    this._nanSequences = nanSequences ?? new RingBuffer(capacityOrIndex);
    this._batchQueryStats = emptyBatchStats();
  }

  append(row) {
    if (this._frozen) throw new TypeError("cannot append to a frozen WaveformHistoryIndex");
    const sequence = this._index.retainedEndSequence;
    const { mins, maxes } = valuesFromRow(row);
    this._index.append(sequence, mins, maxes);
    this._rawRows.push({ mins, maxes });
    if (rowHasNaN(row)) this._nanSequences.push(sequence);
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

  hasNaNInRange(startSequence, endSequence) {
    const start = Math.max(startSequence, this.retainedStartSequence);
    const end = Math.min(endSequence, this.retainedEndSequence - 1);
    if (start > end) return false;
    const index = lowerBound(this._nanSequences, start);
    return index < this._nanSequences.length && sequenceAt(this._nanSequences, index) <= end;
  }

  freeze() {
    return new WaveformHistoryIndex(
      this._index.freeze(),
      true,
      Object.freeze(this._rawRows.toArray()),
      Object.freeze(this._nanSequences.toArray())
    );
  }

  clear() {
    if (this._frozen) throw new TypeError("cannot clear a frozen WaveformHistoryIndex");
    this._index.clear();
    this._rawRows.clear();
    this._nanSequences.clear();
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
