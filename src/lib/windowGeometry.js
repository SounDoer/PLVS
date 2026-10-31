import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The main window's geometry for Window Control: the webview's CSS viewport and scale, and the
 * native inner/outer size, position and monitor work area in physical pixels.
 *
 * @returns {Promise<import("../agentControl/windowControl.js").WindowGeometry>}
 */
export async function readWindowGeometry() {
  const window = getCurrentWindow();
  const [inner, outer, position, maximized, monitor] = await Promise.all([
    window.innerSize(),
    window.outerSize(),
    window.outerPosition(),
    window.isMaximized(),
    currentMonitor(),
  ]);
  return {
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    scale: globalThis.devicePixelRatio || 1,
    inner: { width: inner.width, height: inner.height },
    outer: { width: outer.width, height: outer.height },
    position: { x: position.x, y: position.y },
    maximized,
    workArea: monitor?.workArea
      ? { width: monitor.workArea.size.width, height: monitor.workArea.size.height }
      : null,
  };
}
