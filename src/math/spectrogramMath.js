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

/**
 * Map each output pixel column to an absolute snapshot index range, anchored so
 * that scrolling translates columns instead of re-selecting which snapshots survive.
 *
 * @param {number} totalSnaps         length of the visual snapshot ring
 * @param {number} effectiveOffsetSamples snapshots from the live edge (integer)
 * @param {number} visibleSamples     window width in snapshots (zoom)
 * @param {number} pixelWidth         canvas backing-store width W (device px)
 * @returns {{ ranges: Array<[number, number]>, bucketCount: number }}
 *   ranges[x] = [i0, i1) into the snaps array; i0 === i1 means an empty column.
 */
export function spectrogramColumnRanges(
  totalSnaps,
  effectiveOffsetSamples,
  visibleSamples,
  pixelWidth
) {
  const W = Math.max(1, Math.floor(pixelWidth));
  const windowSamples = Math.max(1, visibleSamples);
  if (totalSnaps <= 0) return { ranges: [], bucketCount: 0 };

  const snapsPerBucket = windowSamples / W;
  const off = Math.max(0, Math.min(Math.max(0, totalSnaps - 1), effectiveOffsetSamples));
  const newestVisible = totalSnaps - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1; // may be < 0 at startup

  const kStart = Math.floor(oldestVisible / snapsPerBucket);
  const kEnd = Math.floor(newestVisible / snapsPerBucket);
  const bucketCount = Math.max(1, kEnd - kStart + 1);

  const visLo = Math.max(0, oldestVisible);
  const visHiExcl = newestVisible + 1; // exclusive
  const ranges = new Array(bucketCount);
  for (let x = 0; x < bucketCount; x++) {
    const k = kStart + x;
    let i0 = Math.ceil(k * snapsPerBucket);
    let i1 = Math.ceil((k + 1) * snapsPerBucket);
    if (i0 < visLo) i0 = visLo;
    if (i1 > visHiExcl) i1 = visHiExcl;
    if (i1 < i0) i1 = i0;
    ranges[x] = [i0, i1];
  }
  return { ranges, bucketCount };
}
