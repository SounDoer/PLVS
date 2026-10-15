// Bundled JetBrains Mono 2.304: each glyph advances 600 / 1000 em.
// Correlation ticks use this font: two 2-character endpoints, one center digit,
// and two 1em gaps. Channel-pair labels require less space.
export const VECTOR_CORRELATION_MIN_EM = 5 * 0.6 + 2;
// Reserve the largest Dock horizontal inset so the minimum never depends on height.
export const VECTOR_DOCK_PAD_X_PX = 8;

export function vectorDockMinWidth(axisFontPx, showAxes = true) {
  // Three reference dots (4 CSS px each), with an axis-font-sized gap between them.
  if (!showAxes) return Math.ceil(3 * 4 + 2 * axisFontPx + 2 * VECTOR_DOCK_PAD_X_PX);
  return Math.ceil(axisFontPx * VECTOR_CORRELATION_MIN_EM + 2 * VECTOR_DOCK_PAD_X_PX);
}
