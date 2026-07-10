const EMPTY_F32 = new Float32Array(0);

export class VectorscopeHistorySlab {
  constructor(capacity, pairValueCount) {
    if (capacity <= 0) throw new RangeError("VectorscopeHistorySlab capacity must be > 0");
    if (pairValueCount <= 0) {
      throw new RangeError("VectorscopeHistorySlab pairValueCount must be > 0");
    }
    this._cap = capacity;
    this._pairValueCount = pairValueCount;
    this._head = 0;
    this._size = 0;
    this._version = 0;
    this._timestamps = new Float64Array(capacity);
    this._pairs = new Float32Array(capacity * pairValueCount);
    this._correlation = new Float64Array(capacity);
    this._sideToMidDb = new Float64Array(capacity);
    this._midEnergy = new Float64Array(capacity);
    this._sideEnergy = new Float64Array(capacity);
  }

  get capacity() {
    return this._cap;
  }

  get length() {
    return this._size;
  }

  get pairValueCount() {
    return this._pairValueCount;
  }

  get version() {
    return this._version;
  }

  timestampAt(index) {
    if (index < 0 || index >= this._size || !this._timestamps) return NaN;
    const slot = (this._head + index) % this._cap;
    return this._timestamps[slot];
  }

  matchesPairValueCount(pairValueCount) {
    return this._pairValueCount === pairValueCount;
  }

  push({ pairs, correlation, sideToMidDb, midEnergy, sideEnergy, timestampMs }) {
    if (!pairs?.length) return;
    if (!this.matchesPairValueCount(pairs.length)) {
      throw new RangeError("VectorscopeHistorySlab cannot store rows with a different pair count");
    }
    if (!this._pairs || !this._timestamps) {
      this._timestamps = new Float64Array(this._cap);
      this._pairs = new Float32Array(this._cap * this._pairValueCount);
      this._correlation = new Float64Array(this._cap);
      this._sideToMidDb = new Float64Array(this._cap);
      this._midEnergy = new Float64Array(this._cap);
      this._sideEnergy = new Float64Array(this._cap);
    }

    const slot = (this._head + this._size) % this._cap;
    const offset = slot * this._pairValueCount;
    this._timestamps[slot] = Number.isFinite(timestampMs) ? timestampMs : -Infinity;
    this._pairs.set(pairs, offset);
    this._correlation[slot] = Number.isFinite(correlation) ? correlation : -Infinity;
    this._sideToMidDb[slot] = Number.isFinite(sideToMidDb) ? sideToMidDb : -Infinity;
    this._midEnergy[slot] = Number.isFinite(midEnergy) ? midEnergy : 0;
    this._sideEnergy[slot] = Number.isFinite(sideEnergy) ? sideEnergy : 0;

    if (this._size < this._cap) {
      this._size += 1;
    } else {
      this._head = (this._head + 1) % this._cap;
    }
    this._version += 1;
  }

  at(index, { copyRows = false } = {}) {
    if (index < 0 || index >= this._size || !this._pairs || !this._timestamps) return undefined;
    const slot = (this._head + index) % this._cap;
    const offset = slot * this._pairValueCount;
    const pairs = this._pairs.subarray(offset, offset + this._pairValueCount);
    return {
      pairs: copyRows ? Float32Array.from(pairs) : pairs,
      correlation: this._correlation[slot],
      sideToMidDb: this._sideToMidDb[slot],
      midEnergy: this._midEnergy[slot],
      sideEnergy: this._sideEnergy[slot],
      timestampMs: this._timestamps[slot],
    };
  }

  rowAt(index, options) {
    return this.at(index, options);
  }

  toArray(options) {
    const out = new Array(this._size);
    for (let i = 0; i < this._size; i += 1) {
      out[i] = this.at(i, options);
    }
    return out;
  }

  freeze() {
    const n = this._size;
    const pvc = this._pairValueCount;
    const timestamps = new Float64Array(n);
    const pairs = new Float32Array(n * pvc);
    const correlation = new Float64Array(n);
    const sideToMidDb = new Float64Array(n);
    const midEnergy = new Float64Array(n);
    const sideEnergy = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const slot = (this._head + i) % this._cap;
      timestamps[i] = this._timestamps[slot];
      pairs.set(this._pairs.subarray(slot * pvc, slot * pvc + pvc), i * pvc);
      correlation[i] = this._correlation[slot];
      sideToMidDb[i] = this._sideToMidDb[slot];
      midEnergy[i] = this._midEnergy[slot];
      sideEnergy[i] = this._sideEnergy[slot];
    }
    return new FrozenVectorscopeHistory({
      pairValueCount: pvc,
      size: n,
      timestamps,
      pairs,
      correlation,
      sideToMidDb,
      midEnergy,
      sideEnergy,
    });
  }

  clear() {
    this._timestamps = null;
    this._pairs = null;
    this._correlation = null;
    this._sideToMidDb = null;
    this._midEnergy = null;
    this._sideEnergy = null;
    this._head = 0;
    this._size = 0;
  }
}

export class FrozenVectorscopeHistory {
  constructor({
    pairValueCount,
    size,
    timestamps,
    pairs,
    correlation,
    sideToMidDb,
    midEnergy,
    sideEnergy,
  }) {
    this._pairValueCount = pairValueCount;
    this._size = size;
    this._timestamps = timestamps;
    this._pairs = pairs;
    this._correlation = correlation;
    this._sideToMidDb = sideToMidDb;
    this._midEnergy = midEnergy;
    this._sideEnergy = sideEnergy;
  }

  get length() {
    return this._size;
  }

  get version() {
    return 0;
  }

  timestampAt(index) {
    if (index < 0 || index >= this._size) return NaN;
    return this._timestamps[index];
  }

  rowAt(index) {
    if (index < 0 || index >= this._size) return undefined;
    const offset = index * this._pairValueCount;
    return {
      pairs:
        this._pairValueCount > 0
          ? this._pairs.subarray(offset, offset + this._pairValueCount)
          : EMPTY_F32,
      correlation: this._correlation[index],
      sideToMidDb: this._sideToMidDb[index],
      midEnergy: this._midEnergy[index],
      sideEnergy: this._sideEnergy[index],
      timestampMs: this._timestamps[index],
    };
  }
}
