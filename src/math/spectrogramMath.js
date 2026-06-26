/**
 * Converts a normalised vertical fraction to Hz on a logarithmic 20–20 000 Hz scale.
 * frac=0 → 20 kHz (top), frac=1 → 20 Hz (bottom).
 * @param {number} frac
 * @returns {number}
 */
export function hzFromFrac(frac, minHz = 20, maxHz = 20000) {
  const safeMin = Math.max(1, Number.isFinite(minHz) ? minHz : 20);
  const safeMax = Math.max(safeMin * 1.001, Number.isFinite(maxHz) ? maxHz : 20000);
  const logMin = Math.log10(safeMin);
  const logDen = Math.log10(safeMax) - logMin;
  return Math.pow(10, frac * logDen + logMin);
}

/**
 * Builds a per-pixel frequency band lookup table for a spectrogram canvas.
 * Each entry maps a canvas Y pixel row to the nearest band index in `bands`.
 * @param {{ fCenter: number }[]} bands
 * @param {number} canvasH
 * @returns {Int16Array}
 */
export function buildYToBand(bands, canvasH, minHz = 20, maxHz = 20000) {
  const lookup = new Int16Array(canvasH);
  for (let y = 0; y < canvasH; y++) {
    const hz = hzFromFrac(1 - y / canvasH, minHz, maxHz);
    let lo = 0,
      hi = bands.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bands[mid].fCenter < hz) lo = mid + 1;
      else hi = mid;
    }
    if (
      lo > 0 &&
      Math.abs(Math.log(bands[lo - 1].fCenter) - Math.log(hz)) <
        Math.abs(Math.log(bands[lo].fCenter) - Math.log(hz))
    ) {
      lookup[y] = lo - 1;
    } else {
      lookup[y] = lo;
    }
  }
  return lookup;
}
