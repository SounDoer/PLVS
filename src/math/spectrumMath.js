import { freqToXFrac, spectrumDbToYViewBox } from "../config/scales.js";

const SPECTRUM_VIEW_W = 1000.0;

/**
 * Reconstruct spectrum SVG path from band centers and dB values.
 * @param {number[]} centers - band center frequencies in Hz
 * @param {number[]} db - smoothed dB per band
 * @param {{ yMaxDb?: number, yRangeDb?: number }} range - optional display Y-axis range
 * @returns {string} SVG path d attribute
 */
export function buildSpectrumSvgFromBandsAndDb(centers, db, range = {}) {
  if (!centers.length || centers.length !== db.length) return "";
  const pts = centers.map((fc, i) => {
    const x = freqToXFrac(fc) * SPECTRUM_VIEW_W;
    const y = spectrumDbToYViewBox(db[i], range);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M ${pts.join(" L ")}`;
}
