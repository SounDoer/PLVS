import { clampDockHeight } from "../dock/dockSizing.js";
import { normalizeDockLayout } from "../dock/dockLayout.js";
import { normalizeDockControlsByPanelId } from "../dock/dockModuleControls.js";
import { normalizeFocusView } from "./focusView.js";
import { normalizePanelPresentation } from "./panelPresentation.js";
import { presetWorkspaceView } from "./presetWorkspaceView.js";
import { normalizeSurfaceOpacity } from "../settings/defaults.js";

/**
 * Everything a preset snapshot captures, as the app holds it now. `windowBounds` is undefined when
 * the window cannot report bounds (outside Tauri, or before the first read); it is then not
 * compared.
 * @typedef {{
 *   tree: any,
 *   panelsById: Record<string, any>,
 *   panelOrder: string[],
 *   panelControlsById: Record<string, any>,
 *   pinnedPanelsById: Record<string, any>,
 *   axisViewports: any,
 *   windowPinned: boolean,
 *   focusView: import("./focusView.js").FocusView,
 *   panelPresentation: import("./panelPresentation.js").PanelPresentation,
 *   surfaceOpacity: number,
 *   glassEnabled: boolean,
 *   dock: any,
 *   loudnessProfileActive?: string,
 *   windowBounds?: { x: number, y: number, width: number, height: number, isMaximized?: boolean },
 * }} PresetScene
 */

/**
 * @typedef {{
 *   dockReserveSpaceSupported?: boolean,
 *   normalizeLoudnessProfileActive?: (raw: unknown) => string,
 * }} PresetDivergenceOptions
 */

/// The scene `usePresets.applySnapshot` would leave behind, starting from `scene`. It must follow
/// apply field by field: anything apply leaves alone keeps the current value here, so it can never
/// read as a divergence.
/**
 * @param {any} preset
 * @param {PresetScene} scene
 * @param {PresetDivergenceOptions} [options]
 * @returns {PresetScene}
 */
export function presetRestoredScene(
  preset,
  scene,
  { dockReserveSpaceSupported = true, normalizeLoudnessProfileActive } = {}
) {
  const presetDockEnabled = preset.dock?.enabled === true;
  const restored = { ...scene, ...presetWorkspaceView(preset) };
  delete restored.fullscreenId;

  if (typeof preset.windowPinned === "boolean") restored.windowPinned = preset.windowPinned;

  const presetFocusView = preset.focusView ? normalizeFocusView(preset.focusView) : null;
  if (presetFocusView) restored.focusView = presetFocusView;
  // A preset that captured neither leaves presentation alone, as apply does.
  if (preset.panelPresentation || presetFocusView) {
    const presentation = normalizePanelPresentation(preset.panelPresentation, presetFocusView);
    if (!presetDockEnabled) presentation.dock = scene.panelPresentation.dock;
    restored.panelPresentation = presentation;
    restored.focusView = {
      ...restored.focusView,
      compactPanels: presentation.workspace.hidePanelHeaders,
    };
  }
  if (typeof preset.surfaceOpacity === "number") {
    restored.surfaceOpacity = normalizeSurfaceOpacity(preset.surfaceOpacity);
  }
  if (typeof preset.glassEnabled === "boolean") restored.glassEnabled = preset.glassEnabled;
  // Apply always restores the selection, even from a preset that predates it.
  if (normalizeLoudnessProfileActive && scene.loudnessProfileActive !== undefined) {
    restored.loudnessProfileActive = normalizeLoudnessProfileActive(preset.loudnessProfileActive);
  }

  if (presetDockEnabled) {
    const dock = preset.dock;
    restored.dock = {
      ...dock,
      enabled: true,
      edge: dock.edge === "top" ? "top" : "bottom",
      // No stored monitor lets the dock pick one, so whichever it picked matches.
      monitor: typeof dock.monitor === "string" ? dock.monitor : scene.dock.monitor,
      reserveSpace: dockReserveSpaceSupported
        ? dock.reserveSpace === true
        : scene.dock.reserveSpace,
      height: Number.isFinite(dock.height) ? clampDockHeight(dock.height) : scene.dock.height,
    };
  } else {
    // A dock-disabled preset only leaves the Dock; it does not restore the strip in its snapshot.
    restored.dock = { ...scene.dock, enabled: false };
  }

  if (preset.windowBounds && !presetDockEnabled && scene.windowBounds) {
    restored.windowBounds = preset.windowBounds;
  }
  return restored;
}

/// Whether applying `preset` would change `scene`: the active preset's modified state.
/**
 * @param {any} preset
 * @param {PresetScene} scene
 * @param {PresetDivergenceOptions} [options]
 */
export function presetDiverges(preset, scene, options) {
  const restored = presetRestoredScene(preset, scene, options);
  return !sameValue(comparable(restored), comparable(scene));
}

function comparable(scene) {
  return { ...scene, dock: comparableDock(scene.dock), windowBounds: comparableBounds(scene) };
}

function comparableDock(dock) {
  const layout = normalizeDockLayout(dock);
  return {
    enabled: dock?.enabled === true,
    edge: dock?.edge,
    monitor: dock?.monitor ?? null,
    reserveSpace: dock?.reserveSpace === true,
    height: dock?.height,
    layout,
    controlsByPanelId: normalizeDockControlsByPanelId(layout.panelsById, dock?.controlsByPanelId),
  };
}

function comparableBounds({ windowBounds: bounds }) {
  if (!bounds) return undefined;
  // A maximised window looks the same whatever normal rectangle it would restore to, and Rust keeps
  // the last normal one on file while the live read reports the maximised one.
  if (bounds.isMaximized === true) return { isMaximized: true };
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: false,
  };
}

/// Structural equality in which a member holding `undefined` counts as absent.
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  const aKeys = Object.keys(a).filter((key) => a[key] !== undefined);
  const bKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => sameValue(a[key], b[key]));
}
