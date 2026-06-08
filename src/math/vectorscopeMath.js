const INV_SQRT2 = 1 / Math.sqrt(2);
const VS_HALF = 130.0;
const VS_SAFE_INSET = 8.0;
const VS_EXTENT_FLOOR = 0.02;
const BASE_PLOT_RADIUS = 96.0;

/**
 * Reconstruct a Lissajous SVG path from stored interleaved float pairs.
 * @param {number[]} pairs - interleaved [L0, R0, L1, R1, …]
 * @returns {string} SVG path d attribute
 */
export function buildVectorscopeSvgFromPairs(pairs) {
  const n = Math.floor(pairs.length / 2);
  if (n === 0) return "";

  let maxCheb = 0;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, pairs[i * 2]));
    const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
    const side = (r - l) * INV_SQRT2;
    const mid = (l + r) * INV_SQRT2;
    const e = Math.max(Math.abs(side), Math.abs(mid));
    if (e > maxCheb) maxCheb = e;
  }

  const extent = Math.max(VS_EXTENT_FLOOR, maxCheb);
  const effRadius = Math.min(BASE_PLOT_RADIUS, (VS_HALF - VS_SAFE_INSET) / extent);

  const pts = [];
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, pairs[i * 2]));
    const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
    const side = (r - l) * INV_SQRT2;
    const mid = (l + r) * INV_SQRT2;
    const x = VS_HALF + side * effRadius;
    const y = VS_HALF - mid * effRadius;
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${pts.join(" L ")}`;
}
