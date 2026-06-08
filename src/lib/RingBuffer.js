export class RingBuffer {
  constructor(capacity) {
    if (capacity <= 0) throw new RangeError("RingBuffer capacity must be > 0");
    this._cap = capacity;
    this._buf = new Array(capacity);
    this._head = 0;
    this._size = 0;
  }

  push(value) {
    const idx = (this._head + this._size) % this._cap;
    this._buf[idx] = value;
    if (this._size < this._cap) {
      this._size++;
    } else {
      this._head = (this._head + 1) % this._cap;
    }
  }

  // 0 = oldest, length-1 = newest
  at(i) {
    if (i < 0 || i >= this._size) return undefined;
    return this._buf[(this._head + i) % this._cap];
  }

  get length() {
    return this._size;
  }

  get capacity() {
    return this._cap;
  }

  toArray() {
    const out = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      out[i] = this._buf[(this._head + i) % this._cap];
    }
    return out;
  }

  clear() {
    this._head = 0;
    this._size = 0;
  }
}
