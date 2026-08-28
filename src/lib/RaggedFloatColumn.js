/**
 * Per-chunk storage for a row payload whose float length varies -- per-channel extrema, waveform
 * sub-blocks. Every row's values sit back to back in one growable Float32Array, and a Uint32 offset
 * table says where each row starts, so a row reads back as a view and nothing is allocated per
 * stored row.
 *
 * A value that arrives unusable stores as `unusableFill`. Waveform extents want 0, the way
 * WaveformVisualHistorySlab writes them; a dB column wants -Infinity, because that is how the audio
 * snap spells silence and 0 would read back as full scale. A Float32Array holds -Infinity exactly,
 * so the fill is a choice rather than a limitation.
 */
export class RaggedFloatColumn {
  /**
   * @param {number} rowCapacity rows this column will hold
   * @param {number} valuesPerRow initial guess; the value buffer doubles when a row overruns it
   * @param {number} unusableFill stored in place of a value that is not a finite number
   */
  constructor(rowCapacity, valuesPerRow = 4, unusableFill = 0) {
    this._offsets = new Uint32Array(Math.max(1, rowCapacity) + 1);
    this._values = new Float32Array(Math.max(1, rowCapacity * valuesPerRow));
    this._unusableFill = unusableFill;
    this._used = 0;
    this._rows = 0;
  }

  get rows() {
    return this._rows;
  }

  get byteLength() {
    return this._values.byteLength + this._offsets.byteLength;
  }

  /** Appends one row's values. Rows are written in order and never revisited. */
  append(values) {
    const count = values?.length ?? 0;
    this._ensure(this._used + count);
    for (let index = 0; index < count; index += 1) {
      const value = values[index];
      this._values[this._used + index] = Number.isFinite(value) ? value : this._unusableFill;
    }
    this._used += count;
    this._rows += 1;
    this._offsets[this._rows] = this._used;
  }

  at(row) {
    if (!Number.isInteger(row) || row < 0 || row >= this._rows) return undefined;
    return this._values.subarray(this._offsets[row], this._offsets[row + 1]);
  }

  lengthAt(row) {
    if (!Number.isInteger(row) || row < 0 || row >= this._rows) return 0;
    return this._offsets[row + 1] - this._offsets[row];
  }

  /** A copy holding only the rows written so far; used when a live chunk is frozen. */
  clone() {
    const copy = new RaggedFloatColumn(0, 1, this._unusableFill);
    copy._offsets = this._offsets.slice(0, this._rows + 1);
    copy._values = this._values.slice(0, this._used);
    copy._used = this._used;
    copy._rows = this._rows;
    return copy;
  }

  _ensure(capacity) {
    if (capacity <= this._values.length) return;
    let next = Math.max(1, this._values.length);
    while (next < capacity) next *= 2;
    const grown = new Float32Array(next);
    grown.set(this._values.subarray(0, this._used));
    this._values = grown;
  }
}
