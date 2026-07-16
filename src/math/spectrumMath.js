import { rangedFreqToXFrac, spectrumDbToYViewBox } from "../config/scales.js";

const SPECTRUM_VIEW_W = 1000.0;

/**
 * Reconstruct spectrum SVG path from band centers and dB values.
 * @param {number[]} centers - band center frequencies in Hz
 * @param {number[]} db - smoothed dB per band
 * @param {{ minHz?: number, maxHz?: number, yMaxDb?: number, yMinDb?: number }} range - optional display range
 * @returns {string} SVG path d attribute
 */
export function buildSpectrumSvgFromBandsAndDb(centers, db, range = {}) {
  if (!centers.length || centers.length !== db.length) return "";
  const pts = centers.map((fc, i) => {
    const x = rangedFreqToXFrac(fc, range.minHz, range.maxHz) * SPECTRUM_VIEW_W;
    const y = spectrumDbToYViewBox(db[i], range);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M ${pts.join(" L ")}`;
}

/**
 * Topographic prominence of the local maximum at `i`: how far the curve must descend from it
 * before it can climb to anything higher, on whichever side is shallower.
 *
 * Height alone is the wrong measure of "worth labelling" — a small bump riding on the shoulder
 * of a big peak can be taller than an isolated one across the spectrum, while saying much less.
 * Prominence is what distinguishes a summit from a step on a slope.
 *
 * @param {number[]} db
 * @param {number} i
 * @returns {number} prominence in dB
 */
function peakProminenceDb(db, i) {
  const height = db[i];
  let leftFloor = height;
  for (let k = i - 1; k >= 0; k -= 1) {
    if (db[k] > height) break;
    if (db[k] < leftFloor) leftFloor = db[k];
  }
  let rightFloor = height;
  for (let k = i + 1; k < db.length; k += 1) {
    if (db[k] > height) break;
    if (db[k] < rightFloor) rightFloor = db[k];
  }
  // The shallower side bounds it: a peak is only as prominent as its easiest escape.
  return height - Math.max(leftFloor, rightFloor);
}

/**
 * Finds the peaks worth labelling in a spectrum curve, most prominent first.
 *
 * Peaks are read off the curve as displayed, so what gets labelled is what the eye sees. The
 * display tilt does not skew this: it is a smooth slope, and across the ~1/6-octave span that
 * sets a peak's prominence it contributes well under a dB.
 *
 * @param {{ fCenter: number }[]} bands
 * @param {number[]} db - dB per band, aligned with `bands`
 * @param {{ count?: number, minProminenceDb?: number, minSeparationOct?: number,
 *           minHz?: number, maxHz?: number }} [options]
 * @returns {{ index: number, freq: number, db: number, prominenceDb: number }[]}
 */
export function findSpectrumPeaks(bands, db, options = {}) {
  const {
    count = 5,
    minProminenceDb = 6,
    minSeparationOct = 1 / 6,
    minHz = -Infinity,
    maxHz = Infinity,
  } = options;
  if (!bands?.length || bands.length !== db?.length) return [];

  const candidates = [];
  // Endpoints are skipped: with only one neighbour there is no way to tell a summit from a
  // curve still on its way up or down past the edge of the view.
  for (let i = 1; i < bands.length - 1; i += 1) {
    const height = db[i];
    if (!Number.isFinite(height)) continue;
    if (!(height > db[i - 1] && height > db[i + 1])) continue;
    const freq = bands[i].fCenter;
    if (freq < minHz || freq > maxHz) continue;
    const prominenceDb = peakProminenceDb(db, i);
    if (prominenceDb < minProminenceDb) continue;
    candidates.push({ index: i, freq, db: height, prominenceDb });
  }

  candidates.sort((a, b) => b.prominenceDb - a.prominenceDb);

  // Prominence already suppresses most near-neighbours — two bumps sharing a shallow valley
  // leave the lower one unprominent. It does not bound how close two *genuinely* separate
  // peaks can sit, though, and labels that overlap on screen are worse than a missing one.
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    const tooClose = picked.some(
      (p) => Math.abs(Math.log2(candidate.freq / p.freq)) < minSeparationOct
    );
    if (!tooClose) picked.push(candidate);
  }
  return picked;
}
