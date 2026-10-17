import { UI_PREFERENCES } from "../preferences/data.js";
import { resolveInterfacePreferences } from "../preferences/interfaceSize.js";

/// The smallest strip any interface size allows: three Stats rows at the default size. Matches
/// Rust's DOCK_MIN_LOGICAL_HEIGHT and is the wire-format lower bound. Larger interface sizes raise
/// the minimum through dockMinHeight().
export const DOCK_MIN_HEIGHT = 68;
/// Dock module padding and Stats row gap, in CSS px. Shared by the CSS tokens and the minimum.
export const DOCK_PAD_X = 6;
export const DOCK_PAD_Y = 4;
export const DOCK_STATS_ROW_GAP = 3;
/// First-run Dock height. Matches Rust's DOCK_DEFAULT_LOGICAL_HEIGHT, which first entry uses
/// because the GUI passes no height.
export const DOCK_DEFAULT_HEIGHT = 180;
// Wire-format bound only; native geometry fits requests to the current display.
export const DOCK_MAX_HEIGHT = 0xffffffff;
/// Height of the Dock toolbar window. Matches Rust's DOCK_HEADER_LOGICAL_HEIGHT, and is what the
/// shell header classes come to at the Small interface profile accessory WebViews are pinned to.
export const DOCK_HEADER_HEIGHT = 36;

/**
 * The strip's minimum for an interface size: three single-line Stats rows, so the minimum follows
 * the global text size instead of a fixed pixel value.
 *
 * @param {string} [interfaceSize]
 */
export function dockMinHeight(interfaceSize) {
  const { metricValue } = resolveInterfacePreferences(UI_PREFERENCES, interfaceSize).typography
    .sizesPx;
  return Math.max(DOCK_MIN_HEIGHT, 3 * metricValue + 2 * DOCK_STATS_ROW_GAP + 2 * DOCK_PAD_Y);
}

/**
 * @param {unknown} value
 * @param {number} [minHeight]
 */
export function clampDockHeight(value, minHeight = DOCK_MIN_HEIGHT) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(DOCK_DEFAULT_HEIGHT, minHeight);
  return Math.max(minHeight, Math.min(DOCK_MAX_HEIGHT, Math.round(number)));
}

export function dockHeightFromPointer({
  edge,
  startHeight,
  startY,
  currentY,
  minHeight = DOCK_MIN_HEIGHT,
}) {
  const delta = edge === "top" ? currentY - startY : startY - currentY;
  return clampDockHeight(startHeight + delta, minHeight);
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
