/** Inner size bounds for `window resize`, in CSS px. */
export const WINDOW_SIZE_MIN = 320;
export const WINDOW_SIZE_MAX = 7680;
/** Upper bound for a `window move` offset from the monitor's work-area origin, in CSS px. */
export const WINDOW_OFFSET_MAX = 7680;

/**
 * A monitor as Window Control sees it: its name as the ID, its scale factor, its work area in
 * physical pixels, and the work-area origin in the platform's desktop units, of which there are
 * `unitsPerCss` per CSS pixel (see `src/lib/windowGeometry.js`).
 *
 * @typedef {{
 *   id: string,
 *   scale: number,
 *   unitsPerCss: number,
 *   origin: { x: number, y: number },
 *   workArea: { x: number, y: number, width: number, height: number },
 * }} WindowMonitor
 */

/**
 * The normal window as Window Control reports it. Sizes are CSS px; the native geometry the
 * frontend reads is physical and is converted with the webview's own scale.
 *
 * @typedef {{
 *   viewport: { width: number, height: number },
 *   scale: number,
 *   inner: { width: number, height: number },
 *   outer: { width: number, height: number },
 *   position: { x: number, y: number },
 *   origin?: { x: number, y: number },
 *   maximized: boolean,
 *   minimized?: boolean,
 *   monitor?: WindowMonitor | null,
 *   workArea: { width: number, height: number } | null,
 * }} WindowGeometry
 */

/**
 * @param {{ form: string, visible: boolean }} state
 * @param {WindowGeometry} geometry
 */
export function buildWindowInspection({ form, visible }, geometry) {
  const monitor = geometry.monitor ?? null;
  return {
    form,
    visible,
    maximized: geometry.maximized,
    minimized: geometry.minimized === true,
    monitor: monitor?.id ?? null,
    position: monitor ? windowOffset(geometry, monitor) : null,
    size: { width: geometry.viewport.width, height: geometry.viewport.height },
    devicePixelRatio: geometry.scale,
    workArea: geometry.workArea
      ? {
          width: Math.floor(geometry.workArea.width / geometry.scale),
          height: Math.floor(geometry.workArea.height / geometry.scale),
        }
      : null,
  };
}

/**
 * Plans the bounds the existing window-bounds path applies for a requested inner size. The
 * top-left stays where it is; a size whose window would not fit the work area is refused rather
 * than letting native clamping silently shrink it.
 *
 * @param {{ form: string }} state
 * @param {WindowGeometry} geometry
 * @param {{ width: number, height: number }} request
 */
export function planWindowResize({ form }, geometry, { width, height }) {
  if (form !== "normal") return { refusal: "dockActive" };
  const inner = {
    width: Math.round(width * geometry.scale),
    height: Math.round(height * geometry.scale),
  };
  const frame = {
    width: Math.max(0, geometry.outer.width - geometry.inner.width),
    height: Math.max(0, geometry.outer.height - geometry.inner.height),
  };
  if (
    geometry.workArea &&
    (inner.width + frame.width > geometry.workArea.width ||
      inner.height + frame.height > geometry.workArea.height)
  ) {
    return { refusal: "windowSizeUnavailable" };
  }
  return {
    bounds: {
      x: geometry.position.x,
      y: geometry.position.y,
      width: inner.width,
      height: inner.height,
      isMaximized: false,
    },
  };
}

/**
 * Whether the webview reports the requested CSS size. One pixel of rounding is allowed for
 * fractional scale factors.
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ width: number, height: number }} request
 */
export function windowSizeSettled(viewport, request) {
  return (
    Math.abs(viewport.width - request.width) <= 1 && Math.abs(viewport.height - request.height) <= 1
  );
}

/**
 * The window's top-left corner as a CSS-pixel offset from its monitor's work-area origin, the
 * coordinate `window move` takes.
 *
 * @param {WindowGeometry} geometry
 * @param {WindowMonitor} monitor
 */
export function windowOffset(geometry, monitor) {
  const origin = geometry.origin ?? geometry.position;
  return {
    x: Math.round((origin.x - monitor.origin.x) / monitor.unitsPerCss),
    y: Math.round((origin.y - monitor.origin.y) / monitor.unitsPerCss),
  };
}

/**
 * Plans a move that puts the window's top-left corner at a CSS-pixel offset on one monitor,
 * keeping its CSS inner size. A window that would leave the work area is refused rather than
 * letting native clamping move it somewhere else.
 *
 * @param {{ form: string }} state
 * @param {WindowGeometry} geometry
 * @param {WindowMonitor[]} monitors
 * @param {{ monitor: string, x: number, y: number }} request
 */
export function planWindowMove({ form }, geometry, monitors, { monitor: monitorId, x, y }) {
  if (form !== "normal") return { refusal: "dockActive" };
  const monitor = monitors.find((candidate) => candidate.id === monitorId);
  if (!monitor) return { refusal: "monitorNotFound" };
  const frame = {
    width: Math.max(0, geometry.outer.width - geometry.inner.width) / geometry.scale,
    height: Math.max(0, geometry.outer.height - geometry.inner.height) / geometry.scale,
  };
  const workArea = {
    width: monitor.workArea.width / monitor.scale,
    height: monitor.workArea.height / monitor.scale,
  };
  if (
    x + geometry.viewport.width + frame.width > workArea.width ||
    y + geometry.viewport.height + frame.height > workArea.height
  ) {
    return { refusal: "windowPositionUnavailable", monitor };
  }
  return {
    monitor,
    target: {
      monitor: monitor.id,
      x,
      y,
      width: geometry.viewport.width,
      height: geometry.viewport.height,
    },
  };
}

/**
 * Whether the window sits on the requested monitor at the requested offset. One CSS pixel of
 * rounding is allowed for fractional scale factors.
 *
 * @param {WindowGeometry} geometry
 * @param {{ monitor: string, x: number, y: number }} request
 */
export function windowPositionSettled(geometry, { monitor, x, y }) {
  if (geometry.monitor?.id !== monitor) return false;
  const offset = windowOffset(geometry, geometry.monitor);
  return Math.abs(offset.x - x) <= 1 && Math.abs(offset.y - y) <= 1;
}
