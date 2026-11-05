function platformText() {
  if (typeof navigator === "undefined") return "";
  return navigator.platform || navigator.userAgent || "";
}

export function isMacOS() {
  return /Mac/i.test(platformText());
}

export function isWindows() {
  return /Win/i.test(platformText());
}

export function isLinux() {
  return /Linux/i.test(platformText());
}

function nativeDockCapabilities() {
  // Rust checks the GTK backend and EWMH support before the first webview loads.
  // A Wayland desktop can run PLVS through XWayland; navigator cannot distinguish them.
  return typeof window === "undefined"
    ? null
    : window.__PLVS_INITIAL_STATE__?.agentControl?.dockCapabilities;
}

export function isDockSupported() {
  const native = nativeDockCapabilities();
  return typeof native?.supported === "boolean" ? native.supported : isWindows() || isMacOS();
}

export function isDockReserveSpaceSupported() {
  const native = nativeDockCapabilities();
  return isDockSupported() && native?.reserveSpace !== false;
}

export function isDockAboveFullScreenSupported() {
  const native = nativeDockCapabilities();
  return typeof native?.aboveFullScreen === "boolean"
    ? native.aboveFullScreen
    : isWindows() || isMacOS();
}
