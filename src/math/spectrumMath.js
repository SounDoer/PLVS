const SPECTRUM_VIEW_W = 1000.0;
const SPEC_VIEW_H = 260.0;
const SPEC_VIEW_TOP_PAD = 10.0;
const SPEC_VIEW_BOTTOM_PAD = 4.0;
const SPEC_DB_MIN = -100.0;
const SPEC_DB_MAX = 0.0;

function freqToXFrac(f) {
  const ff = Math.max(20, Math.min(20000, f));
  const log20 = Math.log10(20);
  const log20k = Math.log10(20000);
  return (Math.log10(ff) - log20) / (log20k - log20);
}

function dbToY(d) {
  const dd = Math.max(SPEC_DB_MIN, Math.min(SPEC_DB_MAX, d));
  const plotH = SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD;
  return (
    SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD - ((dd - SPEC_DB_MIN) / (SPEC_DB_MAX - SPEC_DB_MIN)) * plotH
  );
}

/**
 * Reconstruct spectrum SVG path from band centers and dB values.
 * @param {number[]} centers - band center frequencies in Hz
 * @param {number[]} db - smoothed dB per band
 * @returns {string} SVG path d attribute
 */
export function buildSpectrumSvgFromBandsAndDb(centers, db) {
  if (!centers.length || centers.length !== db.length) return "";
  const pts = centers.map((fc, i) => {
    const x = freqToXFrac(fc) * SPECTRUM_VIEW_W;
    const y = dbToY(db[i]);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M ${pts.join(" L ")}`;
}
