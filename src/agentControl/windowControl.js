/** Inner size bounds for `window resize`, in CSS px. */
export const WINDOW_SIZE_MIN = 320;
export const WINDOW_SIZE_MAX = 7680;

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
 *   maximized: boolean,
 *   workArea: { width: number, height: number } | null,
 * }} WindowGeometry
 */

/**
 * @param {{ form: string, visible: boolean }} state
 * @param {WindowGeometry} geometry
 */
export function buildWindowInspection({ form, visible }, geometry) {
  return {
    form,
    visible,
    maximized: geometry.maximized,
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
