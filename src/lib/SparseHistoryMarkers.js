import { RingBuffer } from "./RingBuffer.js";

function emptyQueryStats() {
  return { binarySearchReads: 0, markersInspected: 0, markersReturned: 0 };
}

function lowerBound(entries, sequence, stats) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    stats.binarySearchReads += 1;
    if (entries.at(middle).sequence < sequence) low = middle + 1;
    else high = middle;
  }
  return low;
}

function queryEntries(entries, retainedStart, retainedEnd, startIndex, endIndex) {
  const stats = emptyQueryStats();
  const retainedRows = retainedEnd - retainedStart;
  const firstIndex = Math.max(0, Math.ceil(startIndex));
  const lastIndex = Math.min(retainedRows - 1, Math.floor(endIndex));
  if (firstIndex > lastIndex) return { matches: [], stats };

  const firstSequence = retainedStart + firstIndex;
  const endSequence = retainedStart + lastIndex + 1;
  const firstMarker = lowerBound(entries, firstSequence, stats);
  const endMarker = lowerBound(entries, endSequence, stats);
  const matches = new Array(endMarker - firstMarker);
  for (let index = firstMarker; index < endMarker; index += 1) {
    const entry = entries.at(index);
    stats.markersInspected += 1;
    matches[index - firstMarker] = {
      sequence: entry.sequence,
      logicalIndex: entry.sequence - retainedStart,
      marker: entry.marker,
    };
  }
  stats.markersReturned = matches.length;
  return { matches, stats };
}

export class SparseHistoryMarkers {
  constructor(capacity) {
    if (capacity <= 0) throw new RangeError("SparseHistoryMarkers capacity must be > 0");
    this._capacity = capacity;
    this._markers = new RingBuffer(capacity);
    this._retainedStart = 0;
    this._nextSequence = 0;
    this._version = 0;
    this._lastQueryStats = emptyQueryStats();
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

  push(marker) {
    const sequence = this._nextSequence;
    if (marker != null) this._markers.push({ sequence, marker });
    this._nextSequence += 1;
    this._retainedStart = Math.max(this._retainedStart, this._nextSequence - this._capacity);
    this._version += 1;
  }

  query(startIndex, endIndex) {
    const result = queryEntries(
      this._markers,
      this._retainedStart,
      this._nextSequence,
      startIndex,
      endIndex
    );
    this._lastQueryStats = result.stats;
    return result.matches;
  }

  lastQueryStats() {
    return { ...this._lastQueryStats };
  }

  freeze() {
    const stats = emptyQueryStats();
    const firstMarker = lowerBound(this._markers, this._retainedStart, stats);
    const markerCount = this._markers.length - firstMarker;
    const markers = new RingBuffer(Math.max(1, markerCount));
    for (let index = firstMarker; index < this._markers.length; index += 1) {
      markers.push(this._markers.at(index));
    }
    return new FrozenSparseHistoryMarkers({
      capacity: this._capacity,
      markers,
      retainedStart: this._retainedStart,
      retainedEnd: this._nextSequence,
      version: this._version,
    });
  }

  clear() {
    this._markers.clear();
    this._retainedStart = this._nextSequence;
    this._version += 1;
    this._lastQueryStats = emptyQueryStats();
  }
}

class FrozenSparseHistoryMarkers {
  constructor({ capacity, markers, retainedStart, retainedEnd, version }) {
    this._capacity = capacity;
    this._markers = markers;
    this._retainedStart = retainedStart;
    this._retainedEnd = retainedEnd;
    this._version = version;
    this._lastQueryStats = emptyQueryStats();
  }

  get capacity() {
    return this._capacity;
  }

  get length() {
    return this._retainedEnd - this._retainedStart;
  }

  get version() {
    return this._version;
  }

  query(startIndex, endIndex) {
    const result = queryEntries(
      this._markers,
      this._retainedStart,
      this._retainedEnd,
      startIndex,
      endIndex
    );
    this._lastQueryStats = result.stats;
    return result.matches;
  }

  lastQueryStats() {
    return { ...this._lastQueryStats };
  }
}
