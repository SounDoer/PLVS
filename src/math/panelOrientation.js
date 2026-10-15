export const PANEL_ORIENTATIONS = Object.freeze([
  "left-to-right",
  "right-to-left",
  "top-to-bottom",
  "bottom-to-top",
]);

/** Pure geometry: direction describes history motion; normalized time increases oldest to newest. */
export function panelOrientation(direction = "right-to-left") {
  const vertical = direction === "bottom-to-top" || direction === "top-to-bottom";
  const reversed = direction === "left-to-right" || direction === "top-to-bottom";
  const timePosition = (fraction) => (reversed ? 1 - fraction : fraction);
  return {
    vertical,
    reversed,
    timeAxis: vertical ? "y" : "x",
    valueAxis: vertical ? "x" : "y",
    oldestEdge: vertical ? (reversed ? "bottom" : "top") : reversed ? "right" : "left",
    newestEdge: vertical ? (reversed ? "top" : "bottom") : reversed ? "left" : "right",
    timePosition,
    timeExtent: (rect) => (vertical ? rect.height : rect.width),
    toScreen: (time, value) =>
      vertical ? { x: value, y: timePosition(time) } : { x: timePosition(time), y: 1 - value },
    fromScreen: (x, y) => ({ time: timePosition(vertical ? y : x), value: vertical ? x : 1 - y }),
  };
}

/** Convert a CSS pointer to logical fractions. The rectangle is the plot, excluding its rails. */
export function orientationPointer(direction, clientX, clientY, rect) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  return panelOrientation(direction).fromScreen(
    clamp((clientX - rect.left) / Math.max(1, rect.width)),
    clamp((clientY - rect.top) / Math.max(1, rect.height))
  );
}

/** SVG transform from chronological left-to-right, top-is-max plot coordinates. */
export function orientationSvgTransform(direction, width, height) {
  switch (direction) {
    case "left-to-right":
      return `matrix(-1 0 0 1 ${width} 0)`;
    case "bottom-to-top":
      return `matrix(0 ${height / width} ${-width / height} 0 ${width} 0)`;
    case "top-to-bottom":
      return `matrix(0 ${-height / width} ${-width / height} 0 ${width} ${height})`;
    default:
      return undefined;
  }
}
