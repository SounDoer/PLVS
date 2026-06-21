const EMPTY_F32 = new Float32Array(0);

function centerOf(band) {
  return band?.fCenter;
}

function sameBands(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(centerOf(a[i]), centerOf(b[i]))) return false;
  }
  return true;
}

function copyPrimaryRow(target, offset, bandCount, values) {
  for (let i = 0; i < bandCount; i += 1) {
    target[offset + i] = Number.isFinite(values?.[i]) ? values[i] : -Infinity;
  }
}

function copySecondaryRow(target, offset, bandCount, values) {
  for (let i = 0; i < bandCount; i += 1) {
    target[offset + i] = Number.isFinite(values?.[i]) ? values[i] : NaN;
  }
}

export class SpectrumHistorySlab {
  constructor(capacity, bands) {
    if (capacity <= 0) throw new RangeError("SpectrumHistorySlab capacity must be > 0");
    this._cap = capacity;
    this._bands = bands ?? [];
    this._bandCount = this._bands.length;
    this._head = 0;
    this._size = 0;
    this._timestamps = new Float64Array(capacity);
    this._dbA = new Float32Array(capacity * this._bandCount);
    this._dbB = null;
  }

  get capacity() {
    return this._cap;
  }

  get length() {
    return this._size;
  }

  get bandCount() {
    return this._bandCount;
  }

  get bands() {
    return this._bands;
  }

  get hasSecondary() {
    return this._dbB != null;
  }

  get dbA() {
    return this._dbA;
  }

  get dbB() {
    return this._dbB;
  }

  get timestamps() {
    return this._timestamps;
  }

  matchesBands(bands) {
    return sameBands(this._bands, bands ?? []);
  }

  push({ bands, dbList, dbListB, timestampMs }) {
    if (!this.matchesBands(bands)) {
      throw new RangeError("SpectrumHistorySlab cannot store rows with a different band grid");
    }
    if (!this._dbA || !this._timestamps) {
      this._timestamps = new Float64Array(this._cap);
      this._dbA = new Float32Array(this._cap * this._bandCount);
    }

    const slot = (this._head + this._size) % this._cap;
    const offset = slot * this._bandCount;
    this._timestamps[slot] = Number.isFinite(timestampMs) ? timestampMs : -Infinity;
    copyPrimaryRow(this._dbA, offset, this._bandCount, dbList);

    if (dbListB?.length || this._dbB) {
      if (!this._dbB) this._dbB = new Float32Array(this._cap * this._bandCount);
      copySecondaryRow(this._dbB, offset, this._bandCount, dbListB);
    }

    if (this._size < this._cap) {
      this._size += 1;
    } else {
      this._head = (this._head + 1) % this._cap;
    }
  }

  at(index) {
    if (index < 0 || index >= this._size || !this._dbA || !this._timestamps) return undefined;
    const slot = (this._head + index) % this._cap;
    const offset = slot * this._bandCount;
    return {
      bands: this._bands,
      dbList: this._dbA.subarray(offset, offset + this._bandCount),
      dbListB: this._dbB ? this._dbB.subarray(offset, offset + this._bandCount) : EMPTY_F32,
      timestampMs: this._timestamps[slot],
    };
  }

  toArray() {
    const out = new Array(this._size);
    for (let i = 0; i < this._size; i += 1) {
      out[i] = this.at(i);
    }
    return out;
  }

  clear() {
    this._timestamps = null;
    this._dbA = null;
    this._dbB = null;
    this._head = 0;
    this._size = 0;
  }
}
