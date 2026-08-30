import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

const EMPTY_QUERY_STATS = Object.freeze({
  nodesVisited: 0,
  rawRowsVisited: 0,
  summaryBucketsVisited: 0,
});

function levelSchema(valueCount) {
  return {
    name: "MinMaxLevel",
    createChunk: (sequenceStart) => {
      const chunk = baseChunk(sequenceStart);
      chunk.mins = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * valueCount);
      chunk.maxes = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * valueCount);
      return chunk;
    },
    cloneChunk: (chunk) => ({
      sequenceStart: chunk.sequenceStart,
      rowCount: chunk.rowCount,
      sealed: true,
      timestamps: chunk.timestamps.slice(0, chunk.rowCount),
      mins: chunk.mins.slice(0, chunk.rowCount * valueCount),
      maxes: chunk.maxes.slice(0, chunk.rowCount * valueCount),
    }),
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength + chunk.mins.byteLength + chunk.maxes.byteLength,
  };
}

function bucketFrom(view, bucketIndex, valueCount) {
  if (view.length === 0) return undefined;
  // A level has no clock, so the base slab's timestamp column carries the absolute bucket index.
  // Pushes are index-contiguous -- bucket k is pushed when row (k + 1) * width - 1 arrives, so no
  // bucket index is ever skipped -- which is what lets a slab index and a bucket index differ by a
  // constant, read off row 0.
  const firstRetained = view.timestampAt(0);
  const found = view.chunkAt(bucketIndex - firstRetained);
  if (!found) return undefined;
  const first = found.row * valueCount;
  return {
    mins: found.chunk.mins.subarray(first, first + valueCount),
    maxes: found.chunk.maxes.subarray(first, first + valueCount),
  };
}

/** One level of the pyramid: bucket n covers [n * width, (n + 1) * width). */
class MinMaxLevel extends ChunkedHistorySlab {
  constructor(capacityBuckets, valueCount) {
    super(capacityBuckets, levelSchema(valueCount));
    this._valueCount = valueCount;
  }

  push(bucketIndex, mins, maxes) {
    this.appendRow(bucketIndex, (chunk, row) => {
      const first = row * this._valueCount;
      for (let value = 0; value < this._valueCount; value += 1) {
        chunk.mins[first + value] = mins[value] ?? 0;
        chunk.maxes[first + value] = maxes[value] ?? 0;
      }
    });
  }

  bucketAt(bucketIndex) {
    return bucketFrom(this, bucketIndex, this._valueCount);
  }

  freeze() {
    return new FrozenMinMaxLevel(this.freezeChunks(), this._valueCount);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

class FrozenMinMaxLevel extends FrozenChunkedHistory {
  constructor(storage, valueCount) {
    super(storage);
    this._valueCount = valueCount;
  }

  bucketAt(bucketIndex) {
    return bucketFrom(this, bucketIndex, this._valueCount);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
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

/**
 * The highest bucket level worth trying at `sequence` with `remaining` rows left.
 *
 * A bucket at level L spans 2^L rows and must start on a multiple of 2^L, so the level is capped
 * by the trailing zeros of `sequence` and by floor(log2(remaining)). Falls back to `maxLevel` for
 * sequences past what the 32-bit intrinsics cover, where the loop's own tests take over.
 */
function startingLevel(maxLevel, sequence, remaining) {
  if (sequence > 0x7fffffff || remaining > 0x7fffffff) return maxLevel;
  const alignment = sequence === 0 ? maxLevel : 31 - Math.clz32(sequence & -sequence);
  const fits = 31 - Math.clz32(remaining);
  return Math.min(maxLevel, alignment, fits);
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
    // Start at the highest level that could possibly apply instead of at the top. Two things bound
    // it: how far `sequence` is aligned, and how much range is left. Scanning down from _maxLevel
    // tested about eighteen levels per bucket that alignment had already ruled out, on a query
    // that visits thousands of buckets per chart build.
    //
    // This is a hint, not a decision: the loop still tests width and alignment itself, so a wrong
    // starting level can only cost speed. A hint that is too low merges more buckets for the same
    // answer -- min and max are associative -- and one that is too high is rejected on entry.
    for (let level = startingLevel(view._maxLevel, sequence, remaining); level >= 1; level--) {
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

  _bucketAtStart(level, startSequence, width) {
    const store = this._levels[level];
    if (!store) return undefined;
    const bucketIndex = startSequence / width;
    if (!Number.isInteger(bucketIndex)) return undefined;
    const bucket = store.bucketAt(bucketIndex);
    if (!bucket) return undefined;
    // Reused rather than allocated per hit: the caller reads `width` and merges `mins`/`maxes`
    // immediately and never keeps the wrapper, and one chart build finds thousands of buckets.
    // Queries do not nest, so one scratch per view is enough.
    const scratch = (this._bucketScratch ??= {
      startSequence: 0,
      width: 0,
      mins: null,
      maxes: null,
    });
    scratch.startSequence = startSequence;
    scratch.width = width;
    scratch.mins = bucket.mins;
    scratch.maxes = bucket.maxes;
    return scratch;
  }

  storageStats() {
    const levels = [];
    let sharedSealedChunks = 0;
    let copiedTailRows = 0;
    let copiedReferences = 0;
    for (let level = 1; level <= this._maxLevel; level += 1) {
      const store = this._levels[level];
      if (!store) continue;
      const stats = store.storageStats();
      levels.push({ level, ...stats });
      sharedSealedChunks += stats.sharedSealedChunks;
      copiedTailRows += stats.copiedTailRows;
      copiedReferences += stats.copiedReferences;
    }
    return { levels, sharedSealedChunks, copiedTailRows, copiedReferences };
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
    const levels = new Array(this._maxLevel + 1);
    for (let level = 1; level <= this._maxLevel; level++) {
      const store = source._levels[level];
      if (store) levels[level] = store.freeze();
    }
    this._levels = Object.freeze(levels);
    this._retainedStartSequence = source._retainedStartSequence;
    this._retainedEndSequence = source._retainedEndSequence;
    this._valueCount = source._valueCount;
    this._version = source._version;
    this._lastQueryStats = EMPTY_QUERY_STATS;
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
    // Levels are allocated on first use: a level's stride is the vector width, and nothing knows
    // that until the first row arrives.
    this._levels = new Array(this._maxLevel + 1);
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

    const widened = Math.max(this._valueCount, mins.length, maxes.length);
    if (widened > this._valueCount) {
      this._valueCount = widened;
      this._restrideLevels();
    }

    let carry = { start: sequence, mins: Array.from(mins), maxes: Array.from(maxes) };
    for (let level = 0; level <= this._maxLevel; level++) {
      const pending = this._pending[level];
      if (!pending) {
        this._pending[level] = carry;
        break;
      }
      this._pending[level] = undefined;
      const merged = { start: pending.start, mins: [], maxes: [] };
      for (let value = 0; value < this._valueCount; value += 1) {
        merged.mins[value] = Math.min(pending.mins[value] ?? 0, carry.mins[value] ?? 0);
        merged.maxes[value] = Math.max(pending.maxes[value] ?? 0, carry.maxes[value] ?? 0);
      }
      carry = merged;
      const nextLevel = level + 1;
      if (nextLevel <= this._maxLevel) {
        const width = 2 ** nextLevel;
        this._ensureLevel(nextLevel).push(merged.start / width, merged.mins, merged.maxes);
      }
    }

    this._retainedEndSequence = sequence + 1;
    this._retainedStartSequence = Math.max(0, this._retainedEndSequence - this._capacity);
    this._version++;
  }

  _ensureLevel(level) {
    if (!this._levels[level]) {
      const width = 2 ** level;
      this._levels[level] = new MinMaxLevel(
        Math.ceil(this._capacity / width) + 2,
        this._valueCount
      );
    }
    return this._levels[level];
  }

  /**
   * Re-lays every existing level at the widened stride.
   *
   * A level's stride is fixed at construction and `push` only ever writes that many values, so a
   * wider bucket pushed into a narrower level is silently truncated -- it cannot corrupt its
   * neighbour, it just loses its extra dimensions. `mergeNode` then reads those dimensions back as
   * 0 through `?? 0`, so a query would report 0 where the real extremum was ±100. Truncation is
   * the default behaviour here, not an alternative to this rebuild.
   *
   * Widening a level's arrays in place is not an option either: its sealed chunks may already be
   * shared with a frozen snapshot that still reads them at its own captured stride. So the buckets
   * are copied into fresh storage and the old level is left untouched for whoever still holds it.
   *
   * The copy is also where the zero-fill contract is honoured: `push` pads through `mins[value] ??
   * 0`, so a dimension that did not exist when a bucket was summarised reads as 0 at the new
   * stride rather than as whatever sat next to it.
   *
   * This costs one pass over the retained buckets, and can happen at most once per distinct vector
   * width -- a channel count, which changes on a device switch and not per row.
   */
  _restrideLevels() {
    for (let level = 1; level <= this._maxLevel; level += 1) {
      const previous = this._levels[level];
      if (!previous) continue;
      const restrided = new MinMaxLevel(previous.capacity, this._valueCount);
      for (let index = 0; index < previous.length; index += 1) {
        const bucketIndex = previous.timestampAt(index);
        const bucket = previous.bucketAt(bucketIndex);
        restrided.push(bucketIndex, bucket.mins, bucket.maxes);
      }
      this._levels[level] = restrided;
    }
  }

  freeze() {
    return new FrozenPowerOfTwoMinMaxIndex(this);
  }

  clear() {
    // Dropped rather than emptied, so the next append rebuilds them at whatever width it brings.
    this._levels = new Array(this._maxLevel + 1);
    this._pending.fill(undefined);
    this._retainedStartSequence = 0;
    this._retainedEndSequence = 0;
    this._valueCount = 0;
    this._lastQueryStats = EMPTY_QUERY_STATS;
    this._version++;
  }
}
