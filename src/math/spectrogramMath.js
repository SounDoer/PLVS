const _LOG20 = Math.log10(20);
const _LOG_DEN = Math.log10(20000) - _LOG20;

/**
 * Converts a normalised vertical fraction to Hz on a logarithmic 20–20 000 Hz scale.
 * frac=0 → 20 kHz (top), frac=1 → 20 Hz (bottom).
 * @param {number} frac
 * @returns {number}
 */
export function hzFromFrac(frac) {
  return Math.pow(10, frac * _LOG_DEN + _LOG20);
}

/**
 * Builds a per-pixel frequency band lookup table for a spectrogram canvas.
 * Each entry maps a canvas Y pixel row to the nearest band index in `bands`.
 * @param {{ fCenter: number }[]} bands
 * @param {number} canvasH
 * @returns {Int16Array}
 */
export function buildYToBand(bands, canvasH) {
  const lookup = new Int16Array(canvasH);
  for (let y = 0; y < canvasH; y++) {
    const hz = hzFromFrac(1 - y / canvasH);
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
