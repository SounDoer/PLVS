import { useWindowChrome } from "../hooks/WindowChromeContext.jsx";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";
import { dockUpdateStatus } from "./dockUpdateStatus.js";
import { useSource } from "../runtime/SourceContext.jsx";
import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { usePresetLibrary } from "../hooks/PresetsContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useDisplaySnapshot } from "../runtime/DisplaySnapshotContext.jsx";
import { useAnalysisSession } from "../runtime/AnalysisSessionContext.jsx";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { preparePanelSettingsNavigation } from "../uiNavigation/panelSettingsNavigation.js";
import { LOUDNESS_PROFILE_OFF } from "../lib/loudnessProfileCatalog.js";
import { errorDetails } from "../lib/errorDetails.js";
import { reportSceneOperationError } from "../lib/sceneOperationNotice.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "./DockContext.jsx";
import { useDockAccessoryBridge } from "./useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./useDockAccessoryVisibility.js";
import { DOCK_HEADER_HEIGHT } from "./dockSizing.js";

/**
 * @typedef {{
 *   visibility: ReturnType<typeof useDockAccessoryVisibility>,
 *   hoveredDockPanelId: string | null,
 *   visualRuntimeRef: import("react").MutableRefObject<any>,
 *   setUpdateGeometry: (value: any) => void,
 * }} DockAccessories
 */
const DockAccessoriesContext = createContext(/** @type {DockAccessories | null} */ (null));

/**
 * The two accessory webviews beside the Dock strip: when each is shown, the state published to
 * them, and what their actions do in the main window.
 *
 * A second owner beside `DockProvider`, not part of it: the accessories list presets and loudness
 * profiles and drive the source, and those owners need the Dock form themselves.
 *
 * Its effects stay in this one component in a fixed order: visibility, navigation registration,
 * then the bridge that publishes to the accessories.
 */
export function DockAccessoriesProvider({ children }) {
  const { updateControls } = useAppLifecycle();
  const { state: workspaceState, setActiveTab, setAxisViewport } = useWorkspaceStore();
  const { historyRetentionSec, interfaceSize } = useAppSettings();
  const { view, setPanelPresentation } = useWindowChrome();
  const presentation = normalizePanelPresentation(view.panelPresentation, view.focusView);
  const {
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    refreshInventory,
    onSelectCaptureDevice,
  } = useSource();
  const { sourceMode, running } = useMeterRuntime();
  const { notice, raiseNotice, clearNotice, showClock } = useMeterDisplayState();
  const { sourceTransportState, histSourceList } = useDisplaySnapshot();
  const historyTotalSamples = histSourceList?.length ?? 0;
  const { channelCount, vectorscopePairOptions, spectrumChannelOptions } = useAnalysisSession();
  const { clearAll, onSourceTransportAction } = useSourceActions();
  const presets = usePresetLibrary();
  const loudnessProfile = useLoudnessProfile();
  const {
    docked,
    dockEdge,
    dockHeight,
    dockSuspended,
    reserveSpace,
    toggleReserveSpace,
    exitDockRestoringAttributes,
    onDockChange,
    layout: dockLayout,
  } = useDock();
  const dockPanels = dockLayout.panels;
  // What Visual Capture may target right now. Written during render and read lazily when a capture
  // request arrives.
  const visualRuntimeRef = useRef(null);
  const [updateGeometry, setUpdateGeometry] = useState(null);

  const onDockAccessoryError = useCallback(
    async (accessoryError) => {
      if (!docked) return;
      const result = await exitDockRestoringAttributes({ reportError: false });
      if (result.ok) {
        raiseNotice(
          "error",
          "Dock controls could not open. The main window was restored.",
          errorDetails("Dock accessory failed", accessoryError)
        );
        return;
      }
      raiseNotice(
        "error",
        "Dock controls could not open, and the main window could not be restored.",
        `${errorDetails("Dock accessory failed", accessoryError)}\n${errorDetails(
          "Restore window failed",
          result.error
        )}`
      );
    },
    [docked, exitDockRestoringAttributes, raiseNotice]
  );
  const dockAccessoryVisibility = useDockAccessoryVisibility({
    preserveOnBlur: Boolean(updateControls.details),
    active: docked && !dockSuspended,
    edge: dockEdge,
    geometryVersion: dockHeight,
    forceHeaderVisible: notice?.kind === "error",
    // Snapshot transport is now always available in the strip; no automatic toolbar reveal.
    snapshotActive: false,
    waitForHeaderReady: true,
    onError: onDockAccessoryError,
  });
  const preparePanelSettings = useCallback(
    ({ panelId }) =>
      preparePanelSettingsNavigation({
        panelId,
        windowForm: docked ? "dock" : "normal",
        workspace: workspaceState,
        dockPanels,
        setActiveTab,
        openDockEditor: dockAccessoryVisibility.openEditor,
      }),
    [docked, dockAccessoryVisibility.openEditor, dockPanels, setActiveTab, workspaceState]
  );
  useUiNavigationTarget("panelSettings", { prepare: preparePanelSettings });
  const dockPanelSettingsView = dockAccessoryVisibility.editorView?.startsWith("module:")
    ? dockAccessoryVisibility.editorView
    : null;
  const dockPanelSettingsId = dockPanelSettingsView?.slice("module:".length) ?? null;
  const dockPanelSettingsActive = Boolean(
    docked &&
    dockAccessoryVisibility.editorVisible &&
    dockPanelSettingsId &&
    dockPanels.some((panel) => panel.id === dockPanelSettingsId)
  );
  useUiSurface({
    active: dockPanelSettingsActive,
    kind: "panelSettings",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { panelId: dockPanelSettingsId, presentation: "dock" },
    onClose: () => dockAccessoryVisibility.closeEditor(dockPanelSettingsView),
  });
  visualRuntimeRef.current = {
    windowForm: docked ? "dock" : "normal",
    sourceMode,
    availableScreenshotTargets: docked
      ? [
          "main",
          ...(dockAccessoryVisibility.headerVisible ? ["dockHeader"] : []),
          ...(dockAccessoryVisibility.editorVisible ? ["dockEditor"] : []),
          ...(updateGeometry?.visible ? ["dockUpdate"] : []),
        ]
      : ["main", "workspace", "panel"],
    availableAudioSources: sourceMode === "live" ? ["none", "measuredSource"] : ["none"],
    accessoryGeometry: {
      dockUpdate: updateGeometry,
      dockHeader: {
        visible: docked && !dockSuspended && dockAccessoryVisibility.headerVisible,
        width: window.innerWidth,
        height: DOCK_HEADER_HEIGHT,
      },
      dockEditor: {
        visible: docked && !dockSuspended && dockAccessoryVisibility.editorVisible,
        width: dockAccessoryVisibility.editorSize.width,
        height: dockAccessoryVisibility.editorSize.height,
      },
    },
  };
  const [hoveredDockPanelId, setHoveredDockPanelId] = useState(null);
  const openUpdateDetails = updateControls.openDetails;
  const dockUpdate = dockUpdateStatus(updateControls);
  const dockUpdateKey = JSON.stringify(dockUpdate);
  const dockHeaderState = useMemo(
    () => ({
      interfaceSize,
      visible: dockAccessoryVisibility.headerVisible,
      presentationId: dockAccessoryVisibility.headerPresentationId,
      sourceTransportState,
      clearDisabled: !running && !showClock,
      notice,
      update: JSON.parse(dockUpdateKey),
      edge: dockEdge,
      reserveSpace,
      editorView: dockAccessoryVisibility.editorView,
      // Configuration metadata is separate from the toolbar's open/closed presentation.
      activeCleanPreset: presets.activeId != null && !presets.dirty,
      loudnessProfileActive: loudnessProfile.active !== LOUDNESS_PROFILE_OFF,
    }),
    [
      interfaceSize,
      dockAccessoryVisibility.editorView,
      dockAccessoryVisibility.headerVisible,
      dockAccessoryVisibility.headerPresentationId,
      dockEdge,
      dockUpdateKey,
      loudnessProfile.active,
      notice,
      presets.activeId,
      presets.dirty,
      reserveSpace,
      running,
      showClock,
      sourceTransportState,
    ]
  );
  const dockEditorState = useMemo(
    () => ({
      interfaceSize,
      view: dockAccessoryVisibility.editorView,
      edge: dockEdge,
      reserveSpace,
      hideAxesAndLabels: presentation.dock.hideAxesAndLabels,
      device: { audioOutputs, audioInputs, captureApplications, safeAudioDeviceId },
      panels: dockLayout.panels,
      panelsById: dockLayout.panelsById,
      panelOrder: dockLayout.panelOrder,
      controlsByPanelId: dockLayout.controlsByPanelId,
      sharedFrequencyViewport: workspaceState.axisViewports.frequency,
      sharedTimeViewport: {
        ...workspaceState.axisViewports.time,
        maxWindowSec: historyRetentionSec,
        totalSamples: historyTotalSamples,
      },
      isDefault: dockLayout.isDefault,
      vectorscopeOptions: vectorscopePairOptions,
      spectrumOptions: spectrumChannelOptions,
      channelCount,
      vectorscopeSettingsAvailable: true,
      presets: {
        list: presets.list.map(({ id, name }) => ({ id, name })),
        activeId: presets.activeId,
        dirty: presets.dirty,
        blocked: presets.blocked,
      },
      // Names only: Dock lists and switches profiles, the rules stay with the main window.
      loudnessProfile: {
        active: loudnessProfile.active,
        profiles: loudnessProfile.profiles.map(({ id, name }) => ({ id, name })),
        draftBlocksLibraryActions: loudnessProfile.draftBlocksLibraryActions,
      },
    }),
    [
      interfaceSize,
      reserveSpace,
      presentation.dock.hideAxesAndLabels,
      audioOutputs,
      audioInputs,
      captureApplications,
      safeAudioDeviceId,
      dockAccessoryVisibility.editorView,
      dockEdge,
      workspaceState.axisViewports.frequency,
      workspaceState.axisViewports.time,
      historyRetentionSec,
      historyTotalSamples,
      dockLayout.controlsByPanelId,
      dockLayout.isDefault,
      dockLayout.panelOrder,
      dockLayout.panels,
      dockLayout.panelsById,
      channelCount,
      loudnessProfile.active,
      loudnessProfile.draftBlocksLibraryActions,
      loudnessProfile.profiles,
      presets.activeId,
      presets.blocked,
      presets.dirty,
      presets.list,
      spectrumChannelOptions,
      vectorscopePairOptions,
    ]
  );
  const onDockAccessoryAction = useCallback(
    ({ type, payload }) => {
      if (type === "header-ready")
        dockAccessoryVisibility.confirmHeaderReady(payload.presentationId);
      else if (type === "source-primary") onSourceTransportAction(payload.actionKind);
      else if (type === "clear") clearAll();
      else if (type === "open-update") openUpdateDetails();
      else if (type === "open-editor") {
        setHoveredDockPanelId(null);
        if (payload.view === "device") void refreshInventory();
        dockAccessoryVisibility.openEditor(payload.view, payload.anchorX);
      } else if (type === "close-editor") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.closeEditor(payload.view, payload.reason);
      } else if (type === "dismiss-toolbar") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.dismiss();
      } else if (type === "resize-editor") dockAccessoryVisibility.resizeEditor(payload);
      else if (type === "set-hide-axes-labels" && typeof payload.value === "boolean") {
        setPanelPresentation({ ...presentation, dock: { hideAxesAndLabels: payload.value } });
      } else if (type === "select-device" && typeof payload.deviceId === "string") {
        void onSelectCaptureDevice(payload.deviceId);
        dockAccessoryVisibility.closeEditor("device");
      } else if (type === "set-edge") void onDockChange(payload.edge);
      else if (type === "toggle-reserve-space") {
        clearNotice();
        void toggleReserveSpace().catch((error) =>
          raiseNotice(
            "error",
            reserveSpace
              ? "Could not release reserved screen space. Dock remains reserved."
              : "Could not reserve screen space. Dock remains an overlay.",
            errorDetails("Reserve screen space failed", error)
          )
        );
      } else if (type === "restore-window") {
        setHoveredDockPanelId(null);
        void exitDockRestoringAttributes();
      } else if (type === "toggle-module") dockLayout.toggle(payload.moduleId);
      else if (type === "add-module") {
        dockLayout.addPanel(payload.moduleId);
      } else if (type === "rename-module") {
        dockLayout.renamePanel(payload.panelId, payload.name);
      } else if (type === "remove-module") {
        dockLayout.removePanel(payload.panelId);
      } else if (type === "reorder-module") {
        if (Array.isArray(payload.panelOrder)) dockLayout.setPanelOrder(payload.panelOrder);
        else dockLayout.reorder(payload.from, payload.to);
      } else if (type === "reset-modules") {
        dockLayout.resetLayout();
      } else if (type === "hover-module") {
        setHoveredDockPanelId(typeof payload.panelId === "string" ? payload.panelId : null);
      } else if (type === "open-module-settings") {
        dockAccessoryVisibility.openEditor(`module:${payload.panelId}`);
      } else if (type === "update-frequency-viewport") {
        if (
          ["spectrum", "spectrogram", "stereo-map"].includes(
            dockLayout.panelsById[payload.panelId]?.moduleId
          )
        )
          setAxisViewport("frequency", payload.viewport);
      } else if (type === "update-time-viewport") {
        if (
          dockLayout.panelsById[payload.panelId] &&
          ["loudness", "waveform", "spectrogram"].includes(
            dockLayout.panelsById[payload.panelId].moduleId
          )
        )
          setAxisViewport("time", payload.viewport);
      } else if (type === "update-module-controls") {
        dockLayout.setPanelControls(payload.panelId, payload.controls);
      } else if (type === "reset-module-controls") {
        dockLayout.resetPanelControls(payload.panelId);
      } else if (type === "apply-preset") {
        clearNotice();
        // The dock row greys these out, but the refusal still has to land somewhere: the strip is
        // a separate webview and its buttons can be a render behind this window's guard.
        void presets
          .apply(payload.presetId)
          .catch((error) =>
            reportSceneOperationError(raiseNotice, error, "Preset failed.", "Preset failed")
          );
      } else if (type === "save-preset") {
        void presets
          .save(payload.name)
          .catch((error) =>
            reportSceneOperationError(raiseNotice, error, "Preset failed.", "Preset failed")
          );
      } else if (type === "update-preset") {
        void presets
          .update(payload.presetId)
          .catch((error) =>
            reportSceneOperationError(raiseNotice, error, "Preset failed.", "Preset failed")
          );
      } else if (type === "rename-preset") presets.rename(payload.presetId, payload.name);
      // Dock's Loudness Profile list is a separate webview with its own settings cache, so it never
      // writes the store itself: the choice lands here, in the provider that owns the state.
      else if (type === "select-loudness-profile") {
        if (typeof payload.selection === "string") loudnessProfile.select(payload.selection);
      } else if (type === "reorder-loudness-profiles") {
        if (Array.isArray(payload.profileIds)) loudnessProfile.reorderProfiles(payload.profileIds);
      } else if (type === "delete-preset") presets.remove(payload.presetId);
      else if (type === "reorder-preset") presets.reorder(payload.presetIds);
    },
    [
      setAxisViewport,
      presentation,
      setPanelPresentation,
      refreshInventory,
      onSelectCaptureDevice,
      clearAll,
      clearNotice,
      dockAccessoryVisibility,
      dockLayout,
      exitDockRestoringAttributes,
      loudnessProfile,
      onDockChange,
      onSourceTransportAction,
      presets,
      raiseNotice,
      reserveSpace,
      toggleReserveSpace,
      openUpdateDetails,
    ]
  );
  useDockAccessoryBridge({
    active: docked,
    headerState: dockHeaderState,
    editorState: dockEditorState,
    onAction: onDockAccessoryAction,
    onFocus: dockAccessoryVisibility.onAccessoryFocus,
  });

  return (
    <DockAccessoriesContext.Provider
      value={{
        visibility: dockAccessoryVisibility,
        hoveredDockPanelId,
        visualRuntimeRef,
        setUpdateGeometry,
      }}
    >
      {children}
    </DockAccessoriesContext.Provider>
  );
}

export function useDockAccessories() {
  const accessories = useContext(DockAccessoriesContext);
  if (!accessories) {
    throw new Error("useDockAccessories must be used inside DockAccessoriesProvider");
  }
  return accessories;
}
