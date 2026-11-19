import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { moveMainWindow, setMainWindowState } from "../ipc/commands.js";
import { isLinux, isMacOS } from "./platform.js";

/**
 * Monitor and window positions share one coordinate space only on some platforms. Windows and X11
 * report one virtual desktop in physical pixels. macOS reports each monitor's position, and the
 * window's, scaled by that display's own factor, so two physical positions on displays with
 * different factors cannot be compared; there positions are compared in points.
 *
 * @param {{ x: number, y: number }} position  physical, as Tauri reports it
 * @param {number} scale  the factor Tauri scaled that position by
 */
function desktopPoint(position, scale) {
  return isMacOS()
    ? { x: position.x / scale, y: position.y / scale }
    : { x: position.x, y: position.y };
}

/** @param {any} monitor */
function publicMonitor(monitor, cssToLogical = 1) {
  if (typeof monitor?.name !== "string" || !monitor.workArea) return null;
  const scale = monitor.scaleFactor || 1;
  return {
    id: monitor.name,
    scale,
    cssScale: scale * cssToLogical,
    // Desktop units per CSS pixel on this monitor, in the space `origin` uses.
    unitsPerCss: (isMacOS() ? 1 : scale) * cssToLogical,
    origin: desktopPoint(monitor.workArea.position, scale),
    workArea: {
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    },
  };
}

/**
 * The main window's geometry for Window Control: the webview's CSS viewport and scale, and the
 * native inner/outer size, position and monitor work area in physical pixels.
 *
 * @returns {Promise<import("../agentControl/windowControl.js").WindowGeometry>}
 */
export async function readWindowGeometry() {
  const window = getCurrentWindow();
  const [inner, outer, position, maximized, minimized, monitor] = await Promise.all([
    window.innerSize(),
    window.outerSize(),
    window.outerPosition(),
    window.isMaximized(),
    window.isMinimized(),
    currentMonitor(),
  ]);
  const scale = globalThis.devicePixelRatio || 1;
  const nativeScale = monitor?.scaleFactor || scale;
  return {
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    scale,
    nativeScale,
    inner: { width: inner.width, height: inner.height },
    outer: { width: outer.width, height: outer.height },
    // GTK adds client-side decorations to resize requests. Reported native sizes include them.
    sizeSetterUsesViewport: isLinux(),
    position: { x: position.x, y: position.y },
    origin: desktopPoint(position, nativeScale),
    maximized,
    minimized,
    monitor: publicMonitor(monitor, scale / nativeScale),
    workArea: monitor?.workArea
      ? { width: monitor.workArea.size.width, height: monitor.workArea.size.height }
      : null,
  };
}

/**
 * Every monitor with its work area in physical pixels, read on demand like the Dock inventory.
 *
 * @returns {Promise<import("../agentControl/windowControl.js").WindowMonitor[]>}
 */
export async function readWindowMonitors() {
  const [monitors, current] = await Promise.all([availableMonitors(), currentMonitor()]);
  const cssToLogical = (globalThis.devicePixelRatio || 1) / (current?.scaleFactor || 1);
  return monitors.map((monitor) => publicMonitor(monitor, cssToLogical)).filter(Boolean);
}

/**
 * @param {{ monitor: string, x: number, y: number, width: number, height: number }} target
 *   the offset from the monitor's work-area origin and the inner size, in native logical units
 */
export function moveWindowTo(target) {
  return moveMainWindow(target);
}

/** The title bar's Maximize / Restore and the system Minimize, on the main window. */
export function maximizeWindow() {
  return setMainWindowState("maximize");
}

export function unmaximizeWindow() {
  return setMainWindowState("unmaximize");
}

export function minimizeWindow() {
  return setMainWindowState("minimize");
}
