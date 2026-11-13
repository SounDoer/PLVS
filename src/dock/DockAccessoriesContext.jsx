import { KEYBOARD_SHORTCUT_ACTIONS } from "../data/keyboardShortcutActions.js";
import { useWindowChrome } from "../hooks/WindowChromeContext.jsx";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";
import { dockUpdateStatus } from "./dockUpdateStatus.js";
import { useSource } from "../runtime/SourceContext.jsx";
import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { usePresetLibrary } from "../hooks/PresetsContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useDisplaySnapshot } from "../runtime/DisplaySnapshotContext.jsx";
import { useAnalysisSession } from "../runtime/AnalysisSessionContext.jsx";
import {
  useUiNavigationTarget,
  useUiStatusReport,
  useUiSurface,
} from "../uiNavigation/UiNavigationContext.jsx";
import { preparePanelSettingsNavigation } from "../uiNavigation/panelSettingsNavigation.js";
import { LOUDNESS_PROFILE_OFF } from "../lib/loudnessProfileCatalog.js";
import { errorDetails } from "../lib/errorDetails.js";
import { reportSceneOperationError } from "../lib/sceneOperationNotice.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "./DockContext.jsx";
import { useDockAccessoryBridge } from "./useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./useDockAccessoryVisibility.js";
import { DOCK_HEADER_HEIGHT } from "./dockSizing.js";
import { buildAppStatusItems, statusActionTarget, statusHelpTarget } from "../lib/appStatus.js";
import { troubleshootingUrl } from "../lib/troubleshooting.js";
import {
  DOCS_URL,
  SHARESETS_URL,
  RELEASES_INDEX_URL,
  openExternalUrl,
} from "../ipc/openExternal.js";
import { dialogueVadEngineOption } from "../lib/dialogueVadEngines.js";
import { useDevelopmentEventFixtureAdapter } from "../dev/DevelopmentEventFixturesContext.jsx";
import { developmentStatusItems } from "../dev/developmentStatusFixtureData.js";
import { createUiNavigationError } from "../uiNavigation/uiNavigationModel.js";

/** The toolbar menu each Dock editor view is, and the header button that opens it. */
const DOCK_MENUS = {
  device: { menu: "sources", button: "sources" },
  "loudness-profile": { menu: "loudness-profile", button: "profile" },
  modules: { menu: "panels", button: "modules" },
  views: { menu: "views", button: "views" },
  presets: { menu: "presets", button: "presets" },
  status: { menu: "status", button: "status" },
};
const HEADER_ANCHOR_WAIT_MS = 1500;

const STATUS_FIXTURE_NAMES = {
  layout: "status.layout",
  summary: "status.summary",
  details: "status.details",
  speakerlayout: "status.speaker-layout",
  capturefailed: "status.capture-failed",
  update: "status.update",
  updateready: "status.update-ready",
  updatefailed: "status.update-failed",
};

/**
 * @typedef {{
 *   visibility: ReturnType<typeof useDockAccessoryVisibility>,
 *   hoveredDockPanelId: string | null,
 *   visualRuntimeRef: import("react").MutableRefObject<any>,
 *   onSettingsError: (value: any) => Promise<void>,
 *   setSettingsGeometry: (value: any) => void,
 *   exportProfileRef: import("react").MutableRefObject<any>,
 *   setSettingsTargets: (value: any) => void,
 *   setUpdateGeometry: (value: any) => void,
 *   setImportActive: (value: boolean) => void,
 *   statusItems: import("../lib/appStatus.js").AppStatusItem[],
 *   statusOpen: boolean,
 *   runStatusAction: (action: string, topic?: string) => Promise<{url?: string} | undefined>,
 *   openDockMenu: (view: string) => Promise<void>,
 *   getAccessoryTargets: () => { id: string, rect: any, surface: string }[],
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
  const {
    dialogueVadEngine,
    historyRetentionSec,
    interfaceSize,
    settingsOpen,
    settingsOpenEpoch,
    keyboardShortcuts,
    shortcutCapturing,
    shortcutActionRef,
    setSettingsOpen,
  } = useAppSettings();
  const { view, setPanelPresentation, setDockSurfaceOpacity } = useWindowChrome();
  const presentation = normalizePanelPresentation(view.panelPresentation, view.focusView);
  const {
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    footerSourceLabel,
    refreshInventory,
    onSelectCaptureDevice,
  } = useSource();
  const { sourceMode, running, liveAudioDrop } = useMeterRuntime();
  const { notice, raiseNotice, clearNotice, showClock } = useMeterDisplayState();
  const { sourceTransportState, histSourceList, displayAudio } = useDisplaySnapshot();
  const historyTotalSamples = histSourceList?.length ?? 0;
  const { channelCount, vectorscopePairOptions, spectrumChannelOptions } = useAnalysisSession();
  const { clearAll, onSourceTransportAction } = useSourceActions();
  const presets = usePresetLibrary();
  const exportProfileRef = useRef(null);
  const loudnessProfile = useLoudnessProfile();
  const {
    docked,
    dockEdge,
    dockHeight,
    dockSuspended,
    reserveSpace,
    toggleReserveSpace,
    aboveFullScreen,
    toggleAboveFullScreen,
    exitDockRestoringAttributes,
    onDockChange,
    resetDockLayout,
    layoutIsDefault,
    layout: dockLayout,
  } = useDock();
  const dockPanels = dockLayout.panels;
  // What Visual Capture may target right now. Written during render and read lazily when a capture
  // request arrives.
  const visualRuntimeRef = useRef(null);
  const [updateGeometry, setUpdateGeometry] = useState(null);
  const [settingsGeometry, setSettingsGeometry] = useState(null);
  const settingsTargetsRef = useRef([]);
  const setSettingsTargets = useCallback((targets) => {
    settingsTargetsRef.current = targets;
  }, []);
  const [importActive, setImportActive] = useState(false);
  const [statusFixture, setStatusFixture] = useState(null);

  const onDockAccessoryError = useCallback(
    async (accessoryError) => {
      if (!docked) return;
      const result = await exitDockRestoringAttributes({ reportError: false });
      if (result.ok) {
        raiseNotice(
          "error",
          "Dock controls could not open. The main window was restored.",
          errorDetails("Dock accessory failed", accessoryError),
          { helpTopic: "dock" }
        );
        return;
      }
      raiseNotice(
        "error",
        "Dock controls could not open, and the main window could not be restored.",
        `${errorDetails("Dock accessory failed", accessoryError)}\n${errorDetails(
          "Restore window failed",
          result.error
        )}`,
        { helpTopic: "dock" }
      );
    },
    [docked, exitDockRestoringAttributes, raiseNotice]
  );
  const headerForced = statusFixture
    ? ["capture-failed", "speaker-layout"].includes(statusFixture.phase)
    : notice?.requiresAttention === true;
  const dockAccessoryVisibility = useDockAccessoryVisibility({
    preserveOnBlur:
      Boolean(updateControls.details) || importActive || statusFixture?.phase === "speaker-layout",
    active: docked && !dockSuspended,
    edge: dockEdge,
    geometryVersion: dockHeight,
    forceHeaderVisible: headerForced,
    // Snapshot transport is now always available in the strip; no automatic toolbar reveal.
    snapshotActive: false,
    waitForHeaderReady: true,
    onError: onDockAccessoryError,
  });
  const closeDockEditor = dockAccessoryVisibility.closeEditor;
  useEffect(() => {
    if (docked && settingsOpen) closeDockEditor();
  }, [docked, settingsOpen, settingsOpenEpoch, closeDockEditor]);
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

  const [hoveredDockPanelId, setHoveredDockPanelId] = useState(null);

  // Toolbar navigation follows the same path as the header buttons. The header reports where its
  // buttons are each time it is shown, so a menu opened from here anchors where a click would.
  const headerAnchorsRef = useRef(/** @type {Record<string, number>} */ ({}));
  const visibilityRef = useRef(dockAccessoryVisibility);
  visibilityRef.current = dockAccessoryVisibility;
  // Named pointer targets the toolbar and editor WebViews report, in their own CSS pixels.
  const accessoryTargetsRef = useRef(
    /** @type {Record<string, { id: string, rect: any }[]>} */ ({})
  );
  const getAccessoryTargets = useCallback(() => {
    const visibility = visibilityRef.current;
    if (!docked || dockSuspended) return [];
    return [
      ...(settingsGeometry?.visible
        ? settingsTargetsRef.current.map((target) => ({
            ...target,
            surface: settingsGeometry?.windowLabel ?? "dock-settings",
          }))
        : []),
      ...(visibility.headerVisible ? (accessoryTargetsRef.current["dock-header"] ?? []) : []).map(
        (target) => ({ ...target, surface: "dock-header" })
      ),
      ...(visibility.editorVisible ? (accessoryTargetsRef.current["dock-editor"] ?? []) : []).map(
        (target) => ({ ...target, surface: "dock-editor" })
      ),
    ];
  }, [docked, dockSuspended, settingsGeometry]);
  const dockToolbarShown = docked && !dockSuspended && dockAccessoryVisibility.headerVisible;
  const openDockMenu = useCallback(
    async (/** @type {string} */ view) => {
      if (!docked || dockSuspended) {
        throw createUiNavigationError("surfaceUnavailable", { kind: "toolbarMenu" });
      }
      if (!visibilityRef.current.headerVisible) visibilityRef.current.toggleToolbar();
      const button = DOCK_MENUS[view].button;
      const deadline = Date.now() + HEADER_ANCHOR_WAIT_MS;
      while (!Number.isFinite(headerAnchorsRef.current[button]) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      setHoveredDockPanelId(null);
      if (view === "device") void refreshInventory();
      visibilityRef.current.openEditor(view, headerAnchorsRef.current[button]);
    },
    [docked, dockSuspended, refreshInventory]
  );
  const dockMenu =
    docked && dockAccessoryVisibility.editorVisible
      ? DOCK_MENUS[dockAccessoryVisibility.editorView]?.menu
      : undefined;
  useUiSurface({
    active: Boolean(dockMenu),
    kind: "toolbarMenu",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { menu: dockMenu, presentation: "dock" },
    onClose: () => dockAccessoryVisibility.closeEditor(dockAccessoryVisibility.editorView),
  });
  useUiNavigationTarget("dockToolbar", {
    show: () => {
      if (!docked || dockSuspended) {
        throw createUiNavigationError("surfaceUnavailable", { kind: "dockToolbar" });
      }
      if (!visibilityRef.current.headerVisible) visibilityRef.current.toggleToolbar();
    },
  });
  useUiSurface({
    active: dockToolbarShown,
    kind: "dockToolbar",
    origin: "navigable",
    blocking: false,
    // While an error holds the toolbar open, the arrow cannot hide it either.
    dismissible: !headerForced,
    supportedActions: headerForced ? [] : ["close"],
    target: {},
    onClose: () => visibilityRef.current.toggleToolbar(),
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
          ...(settingsGeometry?.visible ? ["dockSettings"] : []),
        ]
      : ["main", "workspace", "panel"],
    availableAudioSources: sourceMode === "live" ? ["none", "measuredSource"] : ["none"],
    accessoryGeometry: {
      dockUpdate: updateGeometry,
      dockSettings: settingsGeometry,
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
  const openUpdateDetails = updateControls.openDetails;
  const dockUpdate = dockUpdateStatus(updateControls);
  const dockUpdateKey = JSON.stringify(dockUpdate);
  const statusKey = JSON.stringify(
    statusFixture
      ? developmentStatusItems(statusFixture.phase)
      : buildAppStatusItems({
          notice,
          layoutUnknown: channelCount > 0 && displayAudio?.loudnessLayoutKnown === false,
          autoChannelRoles: displayAudio?.autoChannelRoles,
          audioDrop: sourceMode === "live" ? liveAudioDrop : null,
          update: dockUpdate,
        })
  );
  const statusItems = useMemo(() => JSON.parse(statusKey), [statusKey]);
  useUiStatusReport(statusItems);
  const runStatusAction = useCallback(
    async (action, topic) => {
      if (action === "update") openUpdateDetails();
      else if (action === "check-update") await updateControls.refreshUpdateCheck();
      else if (action === "settings") setSettingsOpen(true);
      else if (action === "help") {
        const url = troubleshootingUrl(topic);
        if (url) {
          await openExternalUrl(url);
          return { url };
        }
      }
    },
    [openUpdateDetails, setSettingsOpen, updateControls]
  );
  useUiNavigationTarget("statusAction", {
    run: async (target, closeStatus) => {
      const item = statusItems.find(
        (candidate) =>
          statusHelpTarget(candidate) === target || statusActionTarget(candidate) === target
      );
      if (!item) throw createUiNavigationError("uiActionUnavailable", { target });
      if (target === statusHelpTarget(item)) {
        if (docked) await closeStatus();
        return runStatusAction("help", item.helpTopic);
      }
      if (item.action === "update" && !updateControls.updateInfo?.update) {
        throw createUiNavigationError("uiActionUnavailable", { target });
      }
      await closeStatus();
      await runStatusAction(item.action);
      return { showUpdate: item.action === "update" };
    },
  });
  useUiNavigationTarget("externalHelp", {
    run: async (target) => {
      const urls = {
        "help:docs": DOCS_URL,
        "help:releases": updateControls.updateInfo?.releaseUrl || RELEASES_INDEX_URL,
        "help:sharesets": SHARESETS_URL,
        "help:dialogue-detector": dialogueVadEngineOption(dialogueVadEngine).url,
      };
      if (!Object.hasOwn(urls, target))
        throw createUiNavigationError("uiActionUnavailable", { target });
      const url = urls[target];
      await openExternalUrl(url);
      return { url };
    },
  });
  const statusAdapter = (phase) => ({
    canEstablish: () =>
      !statusFixture &&
      !notice &&
      !dockAccessoryVisibility.editorView &&
      !updateControls.details &&
      !importActive,
    establish: async (fixtureId) => {
      setStatusFixture({ fixtureId, phase });
      if (docked && ["details", "speaker-layout"].includes(phase))
        dockAccessoryVisibility.openEditor("status");
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    matches: (id) => statusFixture?.fixtureId === id,
    reset: async (id) => {
      if (statusFixture?.fixtureId !== id) return;
      if (docked && dockAccessoryVisibility.editorView === "status")
        dockAccessoryVisibility.closeEditor("status");
      setStatusFixture(null);
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
    surface: { kind: "status", target: { phase } },
  });
  useDevelopmentEventFixtureAdapter("status.layout", statusAdapter("layout"));
  useDevelopmentEventFixtureAdapter("status.summary", statusAdapter("summary"));
  useDevelopmentEventFixtureAdapter("status.details", statusAdapter("details"));
  useDevelopmentEventFixtureAdapter("status.speaker-layout", statusAdapter("speaker-layout"));
  useDevelopmentEventFixtureAdapter("status.capture-failed", statusAdapter("capture-failed"));
  useDevelopmentEventFixtureAdapter("status.update", statusAdapter("update"));
  useDevelopmentEventFixtureAdapter("status.update-ready", statusAdapter("update-ready"));
  useDevelopmentEventFixtureAdapter("status.update-failed", statusAdapter("update-failed"));
  useUiSurface({
    active:
      Boolean(statusFixture) &&
      (!docked ||
        !["details", "speaker-layout"].includes(statusFixture.phase) ||
        dockAccessoryVisibility.editorVisible),
    kind: "status",
    origin: "event",
    developmentFixture: STATUS_FIXTURE_NAMES[statusFixture?.phase.replaceAll("-", "")],
    lifetimeKey: statusFixture?.fixtureId,
    blocking: false,
    dismissible: false,
    supportedActions: [],
    target: { phase: statusFixture?.phase },
  });
  const activePreset = presets.list.find((preset) => preset.id === presets.activeId);
  const activePresetName = activePreset ? `${activePreset.name}${presets.dirty ? " *" : ""}` : null;
  const loudnessProfileName = loudnessProfile.document
    ? loudnessProfile.document.name || "Untitled"
    : null;
  const dockHeaderState = useMemo(
    () => ({
      interfaceSize,
      keyboard: { bindings: keyboardShortcuts, capturing: shortcutCapturing, running, showClock },
      visible: dockAccessoryVisibility.headerVisible,
      presentationId: dockAccessoryVisibility.headerPresentationId,
      sourceTransportState,
      footer: {
        sourceLabel: footerSourceLabel,
        loudnessProfileName,
        activePresetName,
      },
      clearDisabled: !running && !showClock,
      notice,
      statusItems,
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
      keyboardShortcuts,
      shortcutCapturing,
      footerSourceLabel,
      loudnessProfileName,
      activePresetName,
      dockAccessoryVisibility.editorView,
      dockAccessoryVisibility.headerVisible,
      dockAccessoryVisibility.headerPresentationId,
      dockEdge,
      dockUpdateKey,
      loudnessProfile.active,
      notice,
      statusItems,
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
      keyboard: { bindings: keyboardShortcuts, capturing: shortcutCapturing, running, showClock },
      view: dockAccessoryVisibility.editorView,
      statusItems,
      edge: dockEdge,
      reserveSpace,
      aboveFullScreen,
      hideAxesAndLabels: presentation.dock.hideAxesAndLabels,
      dockSurfaceOpacity: view.dockSurfaceOpacity,
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
      isDefault: layoutIsDefault,
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
      keyboardShortcuts,
      shortcutCapturing,
      running,
      showClock,
      statusItems,
      reserveSpace,
      aboveFullScreen,
      presentation.dock.hideAxesAndLabels,
      view.dockSurfaceOpacity,
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
      layoutIsDefault,
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
    ({ surface, type, payload }) => {
      if (type === "ui-targets") {
        accessoryTargetsRef.current[surface] = Array.isArray(payload.targets)
          ? payload.targets.filter(
              (target) =>
                typeof target?.id === "string" && target.rect && typeof target.rect === "object"
            )
          : [];
        return;
      }
      if (type === "header-ready") {
        dockAccessoryVisibility.confirmHeaderReady(payload.presentationId);
        if (payload.anchors && typeof payload.anchors === "object") {
          headerAnchorsRef.current = Object.fromEntries(
            Object.entries(payload.anchors).filter(
              ([button, x]) => typeof button === "string" && Number.isFinite(x)
            )
          );
        }
      } else if (type === "source-primary") onSourceTransportAction(payload.actionKind);
      else if (type === "clear") clearAll();
      else if (
        type === "keyboard-shortcut" &&
        KEYBOARD_SHORTCUT_ACTIONS.some(({ id }) => id === payload.actionId)
      ) {
        shortcutActionRef.current?.(payload.actionId);
      } else if (type === "open-settings") {
        dockAccessoryVisibility.closeEditor();
        setSettingsOpen(true);
      } else if (type === "open-update") openUpdateDetails();
      else if (type === "status-action") {
        dockAccessoryVisibility.closeEditor();
        void runStatusAction(payload.action, payload.topic);
      } else if (type === "open-editor") {
        setHoveredDockPanelId(null);
        if (payload.view === "device") void refreshInventory();
        dockAccessoryVisibility.openEditor(payload.view, payload.anchorX);
      } else if (type === "close-editor") {
        if (payload.reason === "blur" && importActive) return;
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.closeEditor(payload.view, payload.reason);
      } else if (type === "dismiss-toolbar") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.dismiss();
      } else if (type === "resize-editor") dockAccessoryVisibility.resizeEditor(payload);
      else if (type === "set-hide-axes-labels" && typeof payload.value === "boolean") {
        setPanelPresentation({ ...presentation, dock: { hideAxesAndLabels: payload.value } });
      } else if (type === "set-dock-surface-opacity" && Number.isFinite(payload.value)) {
        setDockSurfaceOpacity(payload.value);
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
            errorDetails("Reserve screen space failed", error),
            { helpTopic: "dock" }
          )
        );
      } else if (type === "toggle-above-full-screen") {
        clearNotice();
        void toggleAboveFullScreen().catch((error) =>
          raiseNotice(
            "error",
            "Could not change Above Full Screen.",
            errorDetails("Above Full Screen failed", error),
            { helpTopic: "dock" }
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
        void resetDockLayout();
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
            reportSceneOperationError(
              raiseNotice,
              error,
              "Preset failed.",
              "Preset failed",
              "preset"
            )
          );
      } else if (type === "save-preset") {
        void presets
          .save(payload.name)
          .catch((error) =>
            reportSceneOperationError(
              raiseNotice,
              error,
              "Preset failed.",
              "Preset failed",
              "preset"
            )
          );
      } else if (type === "update-preset") {
        void presets
          .update(payload.presetId)
          .catch((error) =>
            reportSceneOperationError(
              raiseNotice,
              error,
              "Preset failed.",
              "Preset failed",
              "preset"
            )
          );
      } else if (type === "rename-preset") presets.rename(payload.presetId, payload.name);
      // Dock's Loudness Profile list is a separate webview with its own settings cache, so it never
      // writes the store itself: the choice lands here, in the provider that owns the state.
      else if (type === "select-loudness-profile") {
        if (typeof payload.selection === "string") loudnessProfile.select(payload.selection);
      } else if (type === "create-loudness-profile" || type === "edit-loudness-profile") {
        if (type === "create-loudness-profile") loudnessProfile.beginCreate();
        else if (typeof payload.profileId === "string")
          loudnessProfile.beginEdit(payload.profileId);
        dockAccessoryVisibility.closeEditor("loudness-profile");
      } else if (type === "delete-loudness-profile") {
        loudnessProfile.removeProfile(payload.profileId);
      } else if (type === "export-loudness-profile") {
        dockAccessoryVisibility.closeEditor("loudness-profile");
        void exportProfileRef.current?.(payload.profileId);
      } else if (type === "reorder-loudness-profiles") {
        if (Array.isArray(payload.profileIds)) loudnessProfile.reorderProfiles(payload.profileIds);
      } else if (type === "delete-preset") presets.remove(payload.presetId);
      else if (type === "reorder-preset") presets.reorder(payload.presetIds);
    },
    [
      importActive,
      setSettingsOpen,
      setAxisViewport,
      presentation,
      setPanelPresentation,
      setDockSurfaceOpacity,
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
      toggleAboveFullScreen,
      resetDockLayout,
      openUpdateDetails,
      runStatusAction,
      shortcutActionRef,
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
        setSettingsGeometry,
        onSettingsError: onDockAccessoryError,
        setSettingsTargets,
        exportProfileRef,
        setImportActive,
        statusItems,
        runStatusAction,
        statusOpen: ["details", "speaker-layout"].includes(statusFixture?.phase),
        openDockMenu,
        getAccessoryTargets,
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
