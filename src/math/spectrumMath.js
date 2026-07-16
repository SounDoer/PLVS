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
 * Sub-grid position of the summit at `i`, as an offset in grid points within ±0.5.
 *
 * A grid maximum can only ever name the frequency of one of ~1000 fixed points, so the reported
 * frequency of a peak that is really sitting between two of them snaps to whichever neighbour
 * happens to win — and flips to the other as soon as noise nudges it, at every level of time
 * smoothing. Fitting a parabola through the summit and its two neighbours recovers a continuous
 * estimate, which removes that flicker at its source rather than damping it.
 *
 * Fitted on dB rather than linear power on purpose: a windowed tone's main lobe is close to a
 * parabola in the log domain, which is what makes the classic 3-point fit accurate.
 *
 * @param {number[]} db
 * @param {number} i
 * @returns {number} offset in grid points, within [-0.5, 0.5]
 */
function subGridPeakOffset(db, i) {
  const curvature = db[i - 1] - 2 * db[i] + db[i + 1];
  // Flat or dead straight: no vertex to find, and dividing by it would blow up.
  if (!(curvature < -1e-12)) return 0;
  const offset = (0.5 * (db[i - 1] - db[i + 1])) / curvature;
  return Math.max(-0.5, Math.min(0.5, offset));
}

/**
 * Every local maximum in a spectrum curve, most prominent first — before any decision about
 * which are worth showing. Selection lives in `trackSpectrumPeaks`, which needs to see the
 * ones below the entry bar so that a label already on screen can hold its place.
 *
 * Peaks are read off the curve as displayed, so what gets found is what the eye sees. The
 * display tilt does not skew this: it is a smooth slope, and across the ~1/6-octave span that
 * sets a peak's prominence it contributes well under a dB.
 *
 * @param {{ fCenter: number }[]} bands
 * @param {number[]} db - dB per band, aligned with `bands`
 * @param {{ minProminenceDb?: number, minHz?: number, maxHz?: number }} [options]
 * @returns {{ index: number, freq: number, db: number, prominenceDb: number }[]}
 */
export function findSpectrumPeakCandidates(bands, db, options = {}) {
  const { minProminenceDb = 0, minHz = -Infinity, maxHz = Infinity } = options;
  if (!bands?.length || bands.length !== db?.length) return [];

  const candidates = [];
  // Endpoints are skipped: with only one neighbour there is no way to tell a summit from a
  // curve still on its way up or down past the edge of the view. The parabola needs both
  // neighbours anyway.
  for (let i = 1; i < bands.length - 1; i += 1) {
    const height = db[i];
    if (!Number.isFinite(height)) continue;
    if (!(height > db[i - 1] && height > db[i + 1])) continue;
    const prominenceDb = peakProminenceDb(db, i);
    if (prominenceDb < minProminenceDb) continue;

    // The grid is uniform in log frequency, so a sub-grid offset is a plain interpolation
    // between neighbouring log-frequencies.
    const offset = subGridPeakOffset(db, i);
    const neighbour = offset >= 0 ? bands[i + 1].fCenter : bands[i - 1].fCenter;
    const freq = bands[i].fCenter * (neighbour / bands[i].fCenter) ** Math.abs(offset);
    if (freq < minHz || freq > maxHz) continue;
    candidates.push({ index: i, freq, db: height, prominenceDb });
  }

  candidates.sort((a, b) => b.prominenceDb - a.prominenceDb);
  return candidates;
}

/**
 * Carries a set of peak labels from one frame to the next.
 *
 * Ranking each frame independently churns: two peaks a tenth of a dB apart in prominence swap
 * places on noise alone, and a label vanishes from one and reappears on the other. Time
 * smoothing does not fix it — turning Speed all the way up only slows the swapping down.
 *
 * So a label is a thing with an identity, not a fresh query. It costs `enterProminenceDb` to
 * earn a slot and only `exitProminenceDb` to keep one, which is what stops the swapping: a
 * challenger has to be clearly better, not luckier.
 *
 * @param {{ freq: number }[]} previous - last frame's labels
 * @param {{ index: number, freq: number, db: number, prominenceDb: number }[]} candidates
 *   - this frame's peaks from `findSpectrumPeakCandidates`, prominence-sorted
 * @param {{ count?: number, enterProminenceDb?: number, exitProminenceDb?: number,
 *           matchOct?: number, freqSmoothing?: number, minSeparationOct?: number }} [options]
 * @returns {{ index: number, freq: number, db: number, prominenceDb: number }[]}
 */
export function trackSpectrumPeaks(previous, candidates, options = {}) {
  const {
    count = 5,
    enterProminenceDb = 9,
    exitProminenceDb = 5,
    matchOct = 1 / 12,
    freqSmoothing = 0.35,
    minSeparationOct = 1 / 6,
  } = options;
  if (!candidates?.length) return [];

  const claimed = new Set();
  const picked = [];

  // Incumbents are resolved first, so a label that is still a real peak keeps its slot before
  // any newcomer can take it.
  for (const prev of previous ?? []) {
    let bestIdx = null;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      if (claimed.has(i)) continue;
      const dist = Math.abs(Math.log2(candidates[i].freq / prev.freq));
      if (dist < matchOct && dist < bestDist) {
        bestIdx = i;
        bestDist = dist;
      }
    }
    if (bestIdx == null) continue; // the peak it was on is gone
    const candidate = candidates[bestIdx];
    if (candidate.prominenceDb < exitProminenceDb) continue; // faded past holding on
    claimed.add(bestIdx);
    picked.push({
      ...candidate,
      // Geometric EMA, because frequency is perceived and displayed on a log axis. The parabola
      // takes out the grid snapping; this settles the wander that is left.
      freq: prev.freq * (candidate.freq / prev.freq) ** freqSmoothing,
    });
    if (picked.length >= count) break;
  }

  for (let i = 0; i < candidates.length && picked.length < count; i += 1) {
    if (claimed.has(i)) continue;
    const candidate = candidates[i];
    if (candidate.prominenceDb < enterProminenceDb) continue;
    // Prominence already suppresses most near-neighbours — two bumps sharing a shallow valley
    // leave the lower one unprominent. It does not bound how close two *genuinely* separate
    // peaks can sit, though, and labels that overlap on screen are worse than a missing one.
    const tooClose = picked.some(
      (p) => Math.abs(Math.log2(candidate.freq / p.freq)) < minSeparationOct
    );
    if (tooClose) continue;
    picked.push(candidate);
  }
  return picked;
}
