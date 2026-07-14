export const DOCK_MIN_HEIGHT = 56;
export const DOCK_DEFAULT_HEIGHT = 72;
export const DOCK_MAX_HEIGHT = 160;

export function clampDockHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DOCK_DEFAULT_HEIGHT;
  return Math.max(DOCK_MIN_HEIGHT, Math.min(DOCK_MAX_HEIGHT, Math.round(number)));
}

export function dockHeightFromPointer({ edge, startHeight, startY, currentY }) {
  const delta = edge === "top" ? currentY - startY : startY - currentY;
  return clampDockHeight(startHeight + delta);
}

export function dockHeightKeyboardDelta(edge, key, step) {
  if (key === "ArrowUp") return edge === "bottom" ? step : -step;
  if (key === "ArrowDown") return edge === "top" ? step : -step;
  return 0;
}
