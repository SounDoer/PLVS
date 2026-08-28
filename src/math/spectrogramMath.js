import { SPECTRUM_TILT_PIVOT_HZ } from "./spectrumMath.js";

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
/**
 * Slope tilt in dB for each sample point of a `buildYToBand` mapping.
 *
 * History rows are stored untilted, so the tilt is added at paint time. The mapping is fixed for
 * a given size and frequency range, which makes the offset a point needs fixed too -- worth
 * precomputing once per cache rebuild rather than per painted pixel. See `spectrumTiltOffsets`
 * for the curve-side equivalent and for why the tilt lives on the display side at all.
 *
 * @param {Int16Array|number[]} yToBand
 * @param {{ fCenter: number }[]} bands
 * @param {number} tiltDbPerOctave
 * @returns {Float64Array|null} null when there is nothing to apply
 */
export function buildYTiltDb(yToBand, bands, tiltDbPerOctave) {
  if (!Number.isFinite(tiltDbPerOctave) || tiltDbPerOctave === 0) return null;
  const pivot = Math.log2(SPECTRUM_TILT_PIVOT_HZ);
  const out = new Float64Array(yToBand.length);
  for (let i = 0; i < yToBand.length; i += 1) {
    const center = bands[yToBand[i]]?.fCenter;
    out[i] = center > 0 ? tiltDbPerOctave * (Math.log2(center) - pivot) : 0;
  }
  return out;
}

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
