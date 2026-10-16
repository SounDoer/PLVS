export const DOCK_MIN_HEIGHT = 136;
/// First-run Dock height: room for four rows of Expanded Stats. Matches Rust's
/// DOCK_DEFAULT_LOGICAL_HEIGHT, which first entry uses because the GUI passes no height.
export const DOCK_DEFAULT_HEIGHT = 180;
// Wire-format bound only; native geometry fits requests to the current display.
export const DOCK_MAX_HEIGHT = 0xffffffff;
export const DOCK_COMPACT_MAX_HEIGHT = 63;
export const DOCK_EXPANDED_MIN_HEIGHT = 120;
/// Height of the Dock toolbar window. Matches Rust's DOCK_HEADER_LOGICAL_HEIGHT, and is what the
/// shell header classes come to at the Small interface profile accessory WebViews are pinned to.
export const DOCK_HEADER_HEIGHT = 36;

/**
 * @param {number} value
 */
export function dockHeightMode(value) {
  const height = clampDockHeight(value);
  if (height <= DOCK_COMPACT_MAX_HEIGHT) return "compact";
  if (height >= DOCK_EXPANDED_MIN_HEIGHT) return "expanded";
  return "standard";
}

export function clampDockHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DOCK_DEFAULT_HEIGHT;
  return Math.max(DOCK_MIN_HEIGHT, Math.min(DOCK_MAX_HEIGHT, Math.round(number)));
}

export function dockHeightFromPointer({ edge, startHeight, startY, currentY }) {
  const delta = edge === "top" ? currentY - startY : startY - currentY;
  return clampDockHeight(startHeight + delta);
}

/**
 * @param {string} edge
 * @param {string} key
 * @param {number} step
 */
export function dockHeightKeyboardDelta(edge, key, step) {
  if (key === "ArrowUp") return edge === "bottom" ? step : -step;
  if (key === "ArrowDown") return edge === "top" ? step : -step;
  return 0;
}
