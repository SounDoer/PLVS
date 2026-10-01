/**
 * Where a label's centre sits along a y-axis track, in px from the top, for the three ways
 * AxisRail and its readout marker anchor a label: centred on its value, or tucked against the
 * top or bottom edge.
 */
export function axisLabelCenterPx(position, frac, trackPx, labelPx) {
  if (position === "start") return labelPx / 2;
  if (position === "end") return trackPx - labelPx / 2;
  return frac * trackPx;
}

/**
 * Opacity for a tick label sharing its column with a readout marker: 0 while the two boxes touch
 * or overlap, rising linearly to 1 across one tick height of clearance. It is continuous in the
 * marker's position, so a reading that drifts around a tick fades it in and out rather than
 * toggling it.
 */
export function tickOpacityNearMarker(tickCenterPx, tickPx, markerCenterPx, markerPx) {
  const clearancePx = Math.abs(tickCenterPx - markerCenterPx) - (tickPx + markerPx) / 2;
  return Math.min(1, Math.max(0, clearancePx / tickPx));
}
