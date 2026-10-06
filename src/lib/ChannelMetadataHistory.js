import { ChunkedSequence } from "./ChunkedSequence.js";

function sameMetadata(left, right) {
  return (
    left != null &&
    right != null &&
    left?.frequencyLabel === right?.frequencyLabel &&
    left?.vectorscopePairLabel === right?.vectorscopePairLabel
  );
}

/**
 * @param {number} sequence
 */
function metadataAt(changes, sequence) {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (changes.at(middle).sequence <= sequence) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? changes.at(low - 1).metadata : undefined;
}

/**
 * Fields `MetadataView` reads but leaves to its subclasses to assign.
 *
 * @typedef {{
 *   length: number,
 *   _changes: any,
 *   _retainedStart: number,
 * }} MetadataState
 */

class MetadataView {
  /** @this {MetadataView & MetadataState} */
  /**
   * @this {MetadataView & MetadataState}
   */
  at(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined;
    return metadataAt(this._changes, this._retainedStart + index);
  }

  /** @this {MetadataView & MetadataState} */
  /**
   * @this {MetadataView & MetadataState}
   * @param {number} index
   */
  rowAt(index) {
    return this.at(index);
  }

  /** @this {MetadataView & MetadataState} */
  *[Symbol.iterator]() {
    for (let index = 0; index < this.length; index += 1) yield this.at(index);
  }

  toArray() {
    return Array.from(this);
  }

  /** @this {MetadataView & MetadataState} */
  get changeCount() {
    return this._changes.length;
  }

  /** @this {MetadataView & MetadataState} */
  storageStats() {
    const changes = this._changes.storageStats();
    return {
      ...changes,
      retainedRows: this.length,
      storedChangeRows: changes.retainedRows,
      changeCount: this.changeCount,
    };
  }
}

class FrozenChannelMetadataHistory extends MetadataView {
  constructor({ changes, retainedStart, retainedEnd, version }) {
    super();
    this._changes = changes;
    this._retainedStart = retainedStart;
    this._retainedEnd = retainedEnd;
    this._version = version;
  }

  get length() {
    return this._retainedEnd - this._retainedStart;
  }

  get version() {
    return this._version;
  }
}

export class ChannelMetadataHistory extends MetadataView {
  constructor(capacity, options) {
    super();
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("ChannelMetadataHistory capacity must be a positive integer");
    }
    this._capacity = capacity;
    this._changes = new ChunkedSequence(capacity, options);
    this._retainedStart = 0;
    this._nextSequence = 0;
    this._current = null;
    this._version = 0;
  }

  get capacity() {
    return this._capacity;
  }

  get length() {
    return this._nextSequence - this._retainedStart;
  }

  get version() {
    return this._version;
  }

  push(metadata) {
    if (!sameMetadata(this._current, metadata)) {
      this._current = Object.freeze({
        frequencyLabel: metadata?.frequencyLabel,
        vectorscopePairLabel: metadata?.vectorscopePairLabel,
      });
      this._changes.push({ sequence: this._nextSequence, metadata: this._current });
    }
    this._nextSequence += 1;
    this._retainedStart = Math.max(this._retainedStart, this._nextSequence - this._capacity);
    this._version += 1;
  }

  freeze() {
    return new FrozenChannelMetadataHistory({
      changes: this._changes.freeze(),
      retainedStart: this._retainedStart,
      retainedEnd: this._nextSequence,
      version: this._version,
    });
  }

  clear() {
    this._changes.clear();
    this._retainedStart = this._nextSequence;
    this._current = null;
    this._version += 1;
  }
}
