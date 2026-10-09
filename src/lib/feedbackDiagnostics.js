import { DOCK_MODULE_IDS } from "../dock/dockLayout.js";

// A small whitelist, deliberately independent of the full application/store snapshot.
let dock = null;

export function updateDiagnosticDock(value) {
  dock = {
    enabled: value.enabled === true,
    suspended: value.suspended === true,
    height: value.height,
    previewHeight: value.previewHeight ?? null,
  };
}

export function frontendDiagnostics() {
  return {
    capturedAt: new Date().toISOString(),
    viewportWidth: Math.max(0, Math.round(window.innerWidth)),
    viewportHeight: Math.max(0, Math.round(window.innerHeight)),
    devicePixelRatio: window.devicePixelRatio || 1,
    pageVisible: document.visibilityState === "visible",
    dockMounted: document.querySelector('[data-testid="dock-strip"]') !== null,
    dockModuleCount: document.querySelectorAll('[data-testid="dock-module"]').length,
    dockModuleTypes: [
      ...new Set(
        [...document.querySelectorAll('[data-testid="dock-module"]')]
          .map((element) => element.getAttribute("data-module-id"))
          .filter((id) => DOCK_MODULE_IDS.includes(id))
      ),
    ],
    dock,
  };
}
