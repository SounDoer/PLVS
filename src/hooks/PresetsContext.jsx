import { createContext, useCallback, useContext, useMemo } from "react";
import { usePresets } from "./usePresets.js";
import { useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import { useSceneGuard } from "./SceneGuardContext.jsx";
import { syncSurfaceOpacityWindowShadow } from "./useSurfaceOpacityWindowShadow.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { supportsDockMode } from "../lib/platform.js";
import { errorDetails } from "../lib/errorDetails.js";
import {
  SCENE_OPERATIONS,
  isSceneOperationRefused,
  sceneOperationUnavailableReason,
} from "../lib/sceneOperations.js";

const PresetsContext = createContext(
  /** @type {import("./usePresets.js").PresetsApi | null} */ (null)
);

/**
 * The preset library and the hand-off that applies a preset's Dock state.
 *
 * Enclosed by everything a preset captures or replaces -- workspace, view settings, Dock, loudness
 * profile -- and by the scene guard, so Apply, Save and Update are refused in the business function
 * whichever entry point calls them.
 */
export function PresetsProvider({ children }) {
  const { sourceMode } = useMeterRuntime();
  const { clearNotice, raiseNotice, setSelectedOffset } = useMeterDisplayState();
  const { activeBlockingEditors, assertSceneOperationAllowed } = useSceneGuard();
  const loudnessProfile = useLoudnessProfile();
  const {
    windowPinned: pinned,
    setWindowPinned: setPinnedStored,
    focusView,
    setFocusView,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
  } = useAppSettings();
  const {
    dockEnabled,
    dockEdge,
    dockMonitor,
    dockHeight,
    reserveSpace,
    enterDockMode,
    setReserveSpace,
    resizeDockHeight,
    exitDockRestoringAttributes,
    layout: dockLayout,
  } = useDock();

  // Preset apply hand-off: dock geometry is Rust-owned, so a preset's dock
  // state is applied via enter/exit dock rather than window bounds. Left
  // uncaught here on purpose — usePresets.apply wraps this call and clears
  // activeId on failure (mirroring its existing applyWindowBounds handling).
  const applyDockPreset = useCallback(
    async (presetDock, normalWindow = {}) => {
      clearNotice();
      // Dock is temporarily unavailable on macOS. Keep the preset and Dock
      // implementation intact, but apply the preset's non-Dock state only.
      if (presetDock.enabled && !supportsDockMode()) return false;
      if (presetDock.enabled) {
        dockLayout.setPanels(presetDock);
        const requiresDockTransition =
          !dockEnabled || dockEdge !== presetDock.edge || dockMonitor !== presetDock.monitor;
        if (requiresDockTransition) {
          await enterDockMode(
            presetDock.edge,
            presetDock.reserveSpace,
            presetDock.monitor,
            presetDock.height,
            "preset"
          );
        } else {
          if (presetDock.reserveSpace !== reserveSpace) {
            await setReserveSpace(presetDock.reserveSpace, presetDock.edge, "preset");
          }
          if (Number.isFinite(presetDock.height) && presetDock.height !== dockHeight) {
            await resizeDockHeight(presetDock.height, { persist: true, origin: "preset" });
          }
        }
        setSelectedOffset(-1);
      } else if (dockEnabled) {
        const result = await exitDockRestoringAttributes({
          reportError: false,
          origin: "preset",
          bounds: normalWindow.bounds,
          decorations: normalWindow.focusView
            ? !(normalWindow.focusView.autoHideControls || normalWindow.focusView.borderless)
            : undefined,
          alwaysOnTop: typeof normalWindow.pinned === "boolean" ? normalWindow.pinned : undefined,
        });
        if (!result.ok) throw result.error;
        return true;
      }
      return false;
    },
    [
      clearNotice,
      dockLayout,
      enterDockMode,
      dockEnabled,
      dockEdge,
      dockMonitor,
      dockHeight,
      exitDockRestoringAttributes,
      reserveSpace,
      resizeDockHeight,
      setReserveSpace,
      setSelectedOffset,
    ]
  );

  const onPresetApplyError = useCallback(
    (error) => {
      // A refusal already carries a sentence written for the user, and naming the reason is the
      // difference between "it failed" and knowing what to change. Everything else is a genuine
      // failure: generic line, technical detail on hover.
      if (isSceneOperationRefused(error)) {
        raiseNotice("error", error.message);
        return;
      }
      raiseNotice(
        "error",
        "Preset could not be applied.",
        errorDetails("Preset apply failed", error)
      );
    },
    [raiseNotice]
  );

  // Stable identity: an inline literal would churn captureSnapshot (and the
  // memoized presets API) on every render.
  const presetDockState = useMemo(
    () => ({
      enabled: dockEnabled,
      edge: dockEdge,
      monitor: dockMonitor,
      reserveSpace,
      height: dockHeight,
      panelsById: dockLayout.panelsById,
      panelOrder: dockLayout.panelOrder,
      panelSizesById: dockLayout.panelSizesById,
      controlsByPanelId: dockLayout.controlsByPanelId,
    }),
    [
      dockEnabled,
      dockEdge,
      dockMonitor,
      dockHeight,
      dockLayout.controlsByPanelId,
      dockLayout.panelOrder,
      dockLayout.panelSizesById,
      dockLayout.panelsById,
      reserveSpace,
    ]
  );

  const presets = usePresets({
    windowPinned: pinned,
    setWindowPinned: setPinnedStored,
    focusView,
    setFocusView,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
    dock: presetDockState,
    applyDockPreset,
    applySurfaceOpacity: syncSurfaceOpacityWindowShadow,
    // A platform without dock support is not a refusal: applyDockPreset drops the dock and applies
    // the rest of the preset.
    dockPresetUnavailableReason: (presetDock) =>
      presetDock.enabled && supportsDockMode()
        ? sceneOperationUnavailableReason(SCENE_OPERATIONS.dockEnter, { sourceMode })
        : null,
    onApplyError: onPresetApplyError,
    snapshotLoudnessProfile: loudnessProfile.snapshotForPreset,
    applyLoudnessProfileSnapshot: loudnessProfile.applyPresetSnapshot,
    assertSceneOperationAllowed,
    blockingEditors: activeBlockingEditors,
  });

  return <PresetsContext.Provider value={presets}>{children}</PresetsContext.Provider>;
}

/// Named for what it returns: `usePresets` is the owner hook this provider mounts.
export function usePresetLibrary() {
  const presets = useContext(PresetsContext);
  if (!presets) throw new Error("usePresetLibrary must be used inside PresetsProvider");
  return presets;
}
