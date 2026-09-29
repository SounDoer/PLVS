/**
 * Hairlines: fixed, axis-aligned reference lines drawn on a canvas (zero lines, centre lines).
 *
 * A 1 CSS px line cannot be both exact and crisp at a fractional DPR -- at 1.25 it is 1.25 device
 * pixels, which the rasteriser can only spread across two or three rows at partial strength. A
 * hairline gives up the exact width to stay crisp: a whole number of device pixels on whole pixel
 * rows. The width floors, with a minimum of one, which is the rule Chromium applies to CSS borders,
 * so canvas hairlines match panel borders at every scale.
 *
 * Snapping only lands on the screen's pixel grid because backing stores map 1:1 onto device pixels
 * (see useCanvasBackingStore). Moving marks (selection, scrub markers) and data traces are not
 * hairlines: snapping would make a moving line step, and a trace's exact position is the measurement.
 * SVG is out of scope: `shape-rendering="crispEdges"` was measured to drop 1 px grid lines entirely.
 */
export function hairlineDevicePx(scale) {
  // The epsilon keeps a ratio computed as 1.9999999 from losing a whole pixel.
  return Math.max(1, Math.floor(scale + 1e-6));
}

/** Moves a line centre so a line `widthPx` device pixels wide covers whole pixel rows exactly. */
export function snapHairline(centerPx, widthPx) {
  return Math.round(centerPx - widthPx / 2) + widthPx / 2;
}
