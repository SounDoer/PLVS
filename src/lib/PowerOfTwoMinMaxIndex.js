import { RingBuffer } from "./RingBuffer.js";

const EMPTY_QUERY_STATS = Object.freeze({
  nodesVisited: 0,
  rawRowsVisited: 0,
  summaryBucketsVisited: 0,
});

function createBucket(startSequence, width, mins, maxes) {
  return Object.freeze({
    startSequence,
    width,
    mins: Object.freeze(mins),
    maxes: Object.freeze(maxes),
  });
}

function createRowBucket(sequence, sourceMins, sourceMaxes) {
  const valueCount = Math.max(sourceMins.length, sourceMaxes.length);
  const mins = new Array(valueCount);
  const maxes = new Array(valueCount);
  for (let value = 0; value < valueCount; value++) {
    mins[value] = sourceMins[value] ?? 0;
    maxes[value] = sourceMaxes[value] ?? 0;
  }
  return createBucket(sequence, 1, mins, maxes);
}

function mergeBuckets(left, right) {
  const valueCount = Math.max(left.mins.length, right.mins.length);
  const mins = new Array(valueCount);
  const maxes = new Array(valueCount);
  for (let value = 0; value < valueCount; value++) {
    mins[value] = Math.min(left.mins[value] ?? 0, right.mins[value] ?? 0);
    maxes[value] = Math.max(left.maxes[value] ?? 0, right.maxes[value] ?? 0);
  }
  return createBucket(left.startSequence, left.width * 2, mins, maxes);
}

function bucketAtStart(level, startSequence, width) {
  const first = level.at(0);
  if (!first) return undefined;
  const index = (startSequence - first.startSequence) / width;
  if (!Number.isInteger(index)) return undefined;
  const bucket = level.at(index);
  return bucket?.startSequence === startSequence ? bucket : undefined;
}

function frozenBucketAtStart(level, startSequence, width) {
  const first = level[0];
  if (!first) return undefined;
  const index = (startSequence - first.startSequence) / width;
  if (!Number.isInteger(index)) return undefined;
  const bucket = level[index];
  return bucket?.startSequence === startSequence ? bucket : undefined;
}

function mergeNode(result, node, valueCount) {
  for (let value = 0; value < valueCount; value++) {
    result.mins[value] = Math.min(result.mins[value], node.mins[value] ?? 0);
    result.maxes[value] = Math.max(result.maxes[value], node.maxes[value] ?? 0);
  }
}

function validateRange(startInclusive, endInclusive, rawRowAt) {
  if (!Number.isInteger(startInclusive) || !Number.isInteger(endInclusive)) {
    throw new TypeError("query sequences must be integers");
  }
  if (typeof rawRowAt !== "function") {
    throw new TypeError("rawRowAt must be a function");
  }
}

function queryRange(view, startInclusive, endInclusive, rawRowAt) {
  validateRange(startInclusive, endInclusive, rawRowAt);
  const stats = {
    nodesVisited: 0,
    rawRowsVisited: 0,
    summaryBucketsVisited: 0,
  };
  view._lastQueryStats = stats;

  const start = Math.max(startInclusive, view._retainedStartSequence);
  const end = Math.min(endInclusive, view._retainedEndSequence - 1);
  if (start > end) return null;

  const result = {
    mins: new Array(view._valueCount).fill(Infinity),
    maxes: new Array(view._valueCount).fill(-Infinity),
  };
  let sequence = start;
  while (sequence <= end) {
    const remaining = end - sequence + 1;
    let bucket;
    for (let level = view._maxLevel; level >= 1; level--) {
      const width = 2 ** level;
      if (width > remaining || sequence % width !== 0) continue;
      bucket = view._bucketAtStart(level, sequence, width);
      if (bucket) break;
    }

    if (bucket) {
      mergeNode(result, bucket, view._valueCount);
      sequence += bucket.width;
      stats.summaryBucketsVisited++;
    } else {
      const row = rawRowAt(sequence);
      if (!row) throw new RangeError(`raw row ${sequence} is unavailable`);
      mergeNode(result, row, view._valueCount);
      sequence++;
      stats.rawRowsVisited++;
    }
    stats.nodesVisited++;
  }
  return result;
}

class MinMaxIndexView {
  queryRange(startInclusive, endInclusive, rawRowAt) {
    return queryRange(this, startInclusive, endInclusive, rawRowAt);
  }

  lastQueryStats() {
    return { ...this._lastQueryStats };
  }

  get capacity() {
    return this._capacity;
  }

  get retainedStartSequence() {
    return this._retainedStartSequence;
  }

  get retainedEndSequence() {
    return this._retainedEndSequence;
  }

  get valueCount() {
    return this._valueCount;
  }

  get version() {
    return this._version;
  }
}

class FrozenPowerOfTwoMinMaxIndex extends MinMaxIndexView {
  constructor(source) {
    super();
    this._capacity = source._capacity;
    this._maxLevel = source._maxLevel;
    this._levels = Object.freeze(source._levels.map((level) => Object.freeze(level.toArray())));
    this._retainedStartSequence = source._retainedStartSequence;
    this._retainedEndSequence = source._retainedEndSequence;
    this._valueCount = source._valueCount;
    this._version = source._version;
    this._lastQueryStats = EMPTY_QUERY_STATS;
  }

  _bucketAtStart(level, startSequence, width) {
    return frozenBucketAtStart(this._levels[level], startSequence, width);
  }
}

export class PowerOfTwoMinMaxIndex extends MinMaxIndexView {
  constructor(capacityRows) {
    super();
    if (!Number.isInteger(capacityRows) || capacityRows <= 0) {
      throw new RangeError("PowerOfTwoMinMaxIndex capacity must be a positive integer");
    }
    this._capacity = capacityRows;
    this._maxLevel = Math.floor(Math.log2(capacityRows));
    this._levels = Array.from({ length: this._maxLevel + 1 }, (_, level) => {
      const width = 2 ** level;
      return new RingBuffer(Math.ceil(capacityRows / width) + 2);
    });
    this._pending = new Array(this._maxLevel + 1);
    this._retainedStartSequence = 0;
    this._retainedEndSequence = 0;
    this._valueCount = 0;
    this._version = 0;
    this._lastQueryStats = EMPTY_QUERY_STATS;
  }

  append(sequence, mins, maxes) {
    if (!Number.isInteger(sequence) || sequence !== this._retainedEndSequence) {
      throw new RangeError(`expected sequence ${this._retainedEndSequence}, received ${sequence}`);
    }
    if (
      mins == null ||
      maxes == null ||
      typeof mins.length !== "number" ||
      typeof maxes.length !== "number"
    ) {
      throw new TypeError("mins and maxes must be array-like");
    }

    let carry = createRowBucket(sequence, mins, maxes);
    this._valueCount = Math.max(this._valueCount, carry.mins.length, carry.maxes.length);
    for (let level = 0; level <= this._maxLevel; level++) {
      const pending = this._pending[level];
      if (!pending) {
        this._pending[level] = carry;
        break;
      }
      this._pending[level] = undefined;
      carry = mergeBuckets(pending, carry);
      if (level + 1 <= this._maxLevel) {
        this._levels[level + 1].push(carry);
      }
    }

    this._retainedEndSequence = sequence + 1;
    this._retainedStartSequence = Math.max(0, this._retainedEndSequence - this._capacity);
    this._version++;
  }

  _bucketAtStart(level, startSequence, width) {
    return bucketAtStart(this._levels[level], startSequence, width);
  }

  freeze() {
    return new FrozenPowerOfTwoMinMaxIndex(this);
  }

  clear() {
    for (const level of this._levels) level.clear();
    this._pending.fill(undefined);
    this._retainedStartSequence = 0;
    this._retainedEndSequence = 0;
    this._valueCount = 0;
    this._lastQueryStats = EMPTY_QUERY_STATS;
    this._version++;
  }
}
