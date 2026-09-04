import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./runtime/MeterRuntimeContext.jsx";
import {
  deriveBackendAnalysisRequests,
  deriveChannelLabelRuntime,
  deriveDialogueRuntime,
} from "./runtime/appRuntimeDerivations.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { normalizePanelControls } from "./lib/panelControls.js";
import { normalizeAxisViewport } from "./workspace/axisViewports.js";
import {
  useLoudnessHistory,
  HIST_SAMPLE_SEC,
  VISUAL_HIST_SAMPLE_SEC,
} from "./hooks/useLoudnessHistory.js";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePresets } from "./hooks/usePresets.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "./hooks/LoudnessProfileContext.jsx";
import { BlockingEditorsProvider, useBlockingEditors } from "./hooks/BlockingEditorsContext.jsx";
import {
  SCENE_OPERATIONS,
  SceneOperationUnavailableError,
  isSceneOperationRefused,
  sceneOperationUnavailableReason,
} from "./lib/sceneOperations.js";
import { listMissingPreferredMetrics, planShowMissing } from "./lib/loudnessProfileMissing.js";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
import { useDockMode } from "./hooks/useDockMode.js";
import { useDockLayout } from "./dock/useDockLayout.js";
import { useDockAccessoryBridge } from "./dock/useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./dock/useDockAccessoryVisibility.js";
import { useDockHistoryViewport } from "./dock/useDockHistoryViewport.js";
import { mergeDockAnalysisRequests, mergeDockRetainedKeys } from "./dock/dockAnalysisRequest.js";
import { normalizeDockModuleControls } from "./dock/dockModuleControls.js";
import { hideAppWindow, toggleAppWindow } from "./lib/windowVisibility.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import {
  buildVectorscopePairOptions,
  clampVectorscopePairToAvailable,
  formatVectorscopePairLabel,
} from "./math/vectorscopePairMath.js";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
} from "./math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { seedTokensFromLabels } from "./math/channelRoles.js";
import { AppShell } from "./components/AppShell.jsx";
import { AppSettingsOverlays } from "./components/AppSettingsOverlays.jsx";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
import { supportsDockMode } from "./lib/platform.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { deriveClampedPanelControls } from "./workspace/clampPanelControls.js";
import { deriveAnalysisRequests, deriveRetainedAnalysisKeys } from "./analysis/analysisRequests.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "./ipc/env.js";
import { resetTruePeakMax } from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useApplyUpdate } from "./hooks/useApplyUpdate.js";
import { useFocusViewWindow } from "./hooks/useFocusViewWindow.js";
import { useGlassEffect } from "./hooks/useGlassEffect.js";
import { useFileAnalysisReportExport } from "./hooks/useFileAnalysisReportExport.js";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts.js";
import { useAppGlobalEffects } from "./hooks/useAppGlobalEffects.js";
import { useViewsChromeReveal } from "./hooks/useViewsChromeReveal.js";
import { useRuntimeBackendSync } from "./runtime/useRuntimeBackendSync.js";
import { useSourceTransportActions } from "./hooks/useSourceTransportActions.js";
import { useDialogueEngineRestart } from "./hooks/useDialogueEngineRestart.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import packageInfo from "../package.json";
import { readAgentControlRuntime } from "./agentControl/appSnapshot.js";
import { useAgentControlBridge } from "./agentControl/useAgentControlBridge.js";
import { buildPublicSettings } from "./agentControl/settingsControl.js";
import { BUILTIN_THEMES_V2 } from "./theme/builtinThemesV2.js";

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

export function historyPerformanceHarnessOptionsFromSearch(search) {
  const params = new URLSearchParams(search);
  const enabled = params.get("historyPerf") === "240m";
  return {
    enabled,
    fullVisual: enabled && params.get("historyPerfFullVisual") === "1",
  };
}

export function startHistoryPerformanceHarnessController({
  start,
  intake,
  fullVisual,
  publishAudio,
  requestKeys,
}) {
  intake.reset();
  return start({
    intake,
    fullVisual,
    publishAudio,
    ...requestKeys,
  });
}

export function updateHistoryPerformanceHarnessController(controller, requestKeys) {
  controller?.updateRequestKeys(requestKeys);
}

function errorDetails(prefix, error) {
  return `${prefix}: ${error?.message || String(error)}`;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        {/* Inside MeterRuntime and outside AppContent: dockLayout is a hook in AppContent and
            DockStats is rendered by it, so one provider covers both windows' worth of Stats. */}
        {/* Outside LoudnessProfileProvider: the profile draft registers itself as a blocking
            editor, and so does the theme editor further down in AppContent. */}
        <BlockingEditorsProvider>
          <LoudnessProfileProvider>
            <AppContent />
          </LoudnessProfileProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

function AppContent() {
  const {
    state: workspaceState,
    replaceWorkspace,
    waitForWorkspacePersistenceEnqueue,
    setPanelControlsForPanel,
    setAxisViewport,
  } = useWorkspaceStore();
  const sharedTimeViewport = useMemo(
    () => normalizeAxisViewport("time", workspaceState.axisViewports?.time),
    [workspaceState.axisViewports?.time]
  );
  const sharedTimeViewportRef = useRef(sharedTimeViewport);
  useEffect(() => {
    sharedTimeViewportRef.current = sharedTimeViewport;
  }, [sharedTimeViewport]);
  const setHistoryWindowSec = useCallback(
    (nextWindowSec) => {
      const current = sharedTimeViewportRef.current;
      const windowSec =
        typeof nextWindowSec === "function" ? nextWindowSec(current.windowSec) : nextWindowSec;
      const next = { ...current, windowSec };
      sharedTimeViewportRef.current = next;
      setAxisViewport("time", next);
    },
    [setAxisViewport]
  );
  const setHistoryOffsetSec = useCallback(
    (nextOffsetSec) => {
      const current = sharedTimeViewportRef.current;
      const offsetSec =
        typeof nextOffsetSec === "function" ? nextOffsetSec(current.offsetSec) : nextOffsetSec;
      const next = { ...current, offsetSec };
      sharedTimeViewportRef.current = next;
      setAxisViewport("time", next);
    },
    [setAxisViewport]
  );
  useAppGlobalEffects();
  const {
    sourceMode,
    running,
    fileSessions,
    activeFileSession,
    analyzingFileSession,
    activeFileId,
    analyzingFileId,
    startLive,
    stopLive,
    stopFileAnalysis,
    switchSource,
    clearActiveSource,
    beginFileAnalysis: beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
  } = useMeterRuntime();
  const onClearRef = useRef(null);
  const [vectorscopeResetEpoch, setVectorscopeResetEpoch] = useState(0);
  const [stereoMapResetEpoch, setStereoMapResetEpoch] = useState(0);
  const settings = useSettings({ onClearRef });
  const {
    setSettingsOpen,
    resolvedThemeId,
    resolvedTheme,
    clearShortcut,
    focusView,
    setFocusView,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    channelLabelOverrides,
    setChannelLabelOverrides,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
  } = settings;
  // Hoisted above useDockMode and usePresets: dock entry cancels an open profile
  // draft, and preset capture and apply both need its snapshot helpers. One
  // writer for the reference too - null when Off, which every consumer treats as
  // "there is nothing to show". Reading it this early is safe: it is a context
  // read with no ordering constraints of its own.
  const loudnessProfile = useLoudnessProfile();
  // The scene guard. Every operation that captures, replaces or tears down the current editing
  // scene -- preset apply / save / update, dock entry -- asks it first. See
  // `hooks/BlockingEditorsContext.jsx` for the editor half.
  //
  // Composed here because the two rules have different owners: the registry knows which editors
  // are open, and only App knows the source mode. Everything downstream asks one function, so an
  // entry point cannot pick up one rule and miss the other.
  const { activeBlockingEditors, assertSceneOperationAllowed: assertNoBlockingEditor } =
    useBlockingEditors();
  // FILE mode forbids the dock outright: it is a state conflict, not a missing capability, so it
  // refuses rather than degrading the way a platform without dock support does. Enforced here and
  // not only on the disabled Dock control, so every entry point -- and App Control later -- gets
  // the same answer.
  const assertSceneOperationAllowed = useCallback(
    (operation) => {
      assertNoBlockingEditor(operation);
      const reason = sceneOperationUnavailableReason(operation, { sourceMode });
      if (reason) throw new SceneOperationUnavailableError(operation, reason);
    },
    [assertNoBlockingEditor, sourceMode]
  );
  // Dock hooks run first: `docked` suspends the always-on-top and focus-view
  // window overrides below (Rust owns strip chrome + topmost while docked),
  // and preset capture/apply reads dock state. useDockMode depends only on the
  // profile controller above, so hoisting it above useAlwaysOnTop is safe.
  //
  // The dock is a monitoring posture: AppShell renders the settings overlays
  // (and so the profile editor) only when undocked, and the strip has no profile
  // popover, so a draft carried in would keep outranking the persisted selection
  // for DockStats with no way to see, name, save or cancel it. Entry is therefore
  // refused while one is open -- the discard it used to do instead is exactly what
  // the scene guard exists to prevent.
  const {
    dockEnabled,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockPreviewHeight,
    dockSuspended,
    reserveSpace,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
    resizeDockHeight,
    suspendDockMode,
    resumeDockMode,
  } = useDockMode({ assertSceneOperationAllowed });
  const dockLayout = useDockLayout();
  const docked = isTauri() && dockEnabled;
  // Suspended while docked: a preset apply may flip the stored pin to false
  // while the strip must stay topmost; when docked flips false the effect
  // re-asserts the user's value.
  const { pinned, setPinned } = useAlwaysOnTop({ suspended: docked });
  // Suspended while docked: Rust owns strip chrome (no decorations/shadow);
  // when docked flips false the effect re-runs and re-asserts the user's values.
  useFocusViewWindow(focusView.autoHideControls, focusView.borderless, { suspended: docked });

  const {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = useAudioDevices();

  const onHideWindow = useCallback(async () => {
    if (!isTauri()) return;
    await hideAppWindow({
      docked,
      window: getCurrentWindow(),
      suspendDock: suspendDockMode,
    });
  }, [docked, suspendDockMode]);

  const onToggleWindow = useCallback(async () => {
    if (!isTauri()) return;
    await toggleAppWindow({
      docked,
      window: getCurrentWindow(),
      suspendDock: suspendDockMode,
      resumeDock: resumeDockMode,
    });
  }, [docked, resumeDockMode, suspendDockMode]);

  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, install, restartToApply, resetInstall } = useApplyUpdate();
  const updateBusy = installStatus === "installing" || installStatus === "restarting";

  const {
    dialogOpen: closeDialogOpen,
    handleConfirm: handleCloseConfirm,
    handleCancel: handleCloseCancel,
  } = useCloseConfirm({ onHideWindow, closeBlocked: updateBusy });

  const audioOutputs = useMemo(
    () => (audioDevices || []).filter((d) => d.isSystemOutputMonitor),
    [audioDevices]
  );
  const audioInputs = useMemo(
    () => (audioDevices || []).filter((d) => !d.isSystemOutputMonitor),
    [audioDevices]
  );
  const safeAudioDeviceId = useMemo(() => {
    const allowed = new Set(["default", ...(audioDevices || []).map((d) => d.id)]);
    return allowed.has(captureDeviceId) ? captureDeviceId : "default";
  }, [audioDevices, captureDeviceId]);

  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  const { display, routing } = useMeterRuntimeAssembly();
  const {
    audio,
    setAudio,
    selectedOffset,
    setSelectedOffset,
    selectedSnapshotTimeMs,
    notice,
    raiseNotice,
    clearNotice,
    showClock,
  } = display;
  const { elapsedMsRef } = display.clock;

  // Dock transitions. Exit restores the user's TRUE normal-form attributes
  // (override-not-overwrite): decorations follow focusView, always-on-top follows
  // the pin toggle — dock never persists over stored settings. Every transition
  // UI entry points map IPC rejections to actionable notices so a failed click
  // handler cannot leave an unhandled rejection or stale error copy behind.
  // NOTE: there is no in-flight guard against rapid dock transitions (v1 accepts
  // this; a fast toggle spam could interleave enter/exit IPC calls).
  const exitDockRestoringAttributes = useCallback(
    async ({ reportError = true, bounds, decorations, alwaysOnTop } = {}) => {
      clearNotice();
      try {
        await exitDockMode({
          decorations: decorations ?? !(focusView.autoHideControls || focusView.borderless),
          alwaysOnTop: alwaysOnTop ?? pinned === true,
          bounds,
        });
        return { ok: true, error: null };
      } catch (error) {
        if (reportError) {
          raiseNotice(
            "error",
            "Could not restore the main window. Try again.",
            errorDetails("Restore window failed", error)
          );
        }
        return { ok: false, error };
      }
    },
    [
      clearNotice,
      exitDockMode,
      focusView.autoHideControls,
      focusView.borderless,
      pinned,
      raiseNotice,
    ]
  );

  // A refused scene operation is not a failure to report as one -- the guard did its job. Say
  // what the user has to do instead, and keep the technical detail for everything else.
  const reportSceneOperationError = useCallback(
    (error, fallbackMessage, detailPrefix) => {
      if (isSceneOperationRefused(error)) {
        raiseNotice("error", error.message);
        return;
      }
      raiseNotice("error", fallbackMessage, errorDetails(detailPrefix, error));
    },
    [raiseNotice]
  );

  const onDockChange = useCallback(
    async (edgeOrNull) => {
      clearNotice();
      try {
        if (edgeOrNull) {
          await enterDockMode(edgeOrNull);
          setSelectedOffset(-1);
        } else await exitDockRestoringAttributes();
      } catch (error) {
        reportSceneOperationError(
          error,
          "Could not move Dock. The previous position was kept.",
          "Dock failed"
        );
      }
    },
    [
      clearNotice,
      enterDockMode,
      exitDockRestoringAttributes,
      reportSceneOperationError,
      setSelectedOffset,
    ]
  );

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
            presetDock.height
          );
        } else {
          if (presetDock.reserveSpace !== reserveSpace) {
            await setReserveSpace(presetDock.reserveSpace, presetDock.edge);
          }
          if (Number.isFinite(presetDock.height) && presetDock.height !== dockHeight) {
            await resizeDockHeight(presetDock.height, { persist: true });
          }
        }
        setSelectedOffset(-1);
      } else if (dockEnabled) {
        const result = await exitDockRestoringAttributes({
          reportError: false,
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
    setWindowPinned: setPinned,
    focusView,
    setFocusView,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    dock: presetDockState,
    applyDockPreset,
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
  const agentControlRuntime = useMemo(readAgentControlRuntime, []);

  const historyRetentionSec = settings.historyRetentionSec;
  const dockHistoryViewport = useDockHistoryViewport({ maxWindowSec: historyRetentionSec });
  const histMaxSamples = Math.round(historyRetentionSec / HIST_SAMPLE_SEC);
  const visualMaxSamples = Math.round(historyRetentionSec / VISUAL_HIST_SAMPLE_SEC);

  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const normalizedPanelControls = useMemo(() => {
    const firstPanelId = workspaceState.panelOrder.find((id) => workspaceState.panelsById[id]);
    return normalizePanelControls(
      firstPanelId ? getPanelControls(workspaceState, firstPanelId) : undefined
    );
  }, [workspaceState]);
  const referenceLufs = loudnessProfile.referenceLufs;
  // Only the two metrics the history chart draws can tint their traces; split them out here so the
  // panel and the dock read the same rules from one place.
  const loudnessTraceRules = useMemo(() => {
    const rules = loudnessProfile.document?.rules ?? [];
    return {
      momentary: rules.filter((rule) => rule.metricId === "momentary"),
      shortTerm: rules.filter((rule) => rule.metricId === "shortTerm"),
    };
  }, [loudnessProfile.document]);

  // Missing-stats fulfillment spans every Stats panel: the profile's needs are a session-level
  // statement, so a row added for it should appear wherever Stats is shown. Union for detection,
  // append per panel for the fix -- each panel keeps the order its user arranged.
  const statsPanelIds = useMemo(
    () =>
      workspaceState.panelOrder.filter((id) => workspaceState.panelsById[id]?.moduleId === "stats"),
    [workspaceState]
  );
  // Dock Stats is a second implementation with its own visible ids (dockModuleControls), so both
  // sets have to be unioned for detection and both appended to on fulfill. Missing either half
  // makes Show missing look like it worked while one surface keeps hiding the rows.
  const dockStatsPanelIds = useMemo(
    () =>
      Object.values(dockLayout.panelsById ?? {})
        .filter((panel) => panel?.moduleId === "stats")
        .map((panel) => panel.id),
    [dockLayout.panelsById]
  );
  const loudnessProfileStats = useMemo(() => {
    if (statsPanelIds.length === 0 && dockStatsPanelIds.length === 0) return null;

    const workspaceControls = statsPanelIds.map((panelId) => ({
      panelId,
      controls: normalizePanelControls(getPanelControls(workspaceState, panelId)),
      apply: setPanelControlsForPanel,
    }));
    const dockControls = dockStatsPanelIds.map((panelId) => ({
      panelId,
      controls: normalizeDockModuleControls("stats", dockLayout.controlsByPanelId?.[panelId]),
      apply: dockLayout.setPanelControls,
    }));
    const everyStatsSurface = [...workspaceControls, ...dockControls];

    const seen = new Set();
    for (const { controls } of everyStatsSurface) {
      for (const id of controls.statsVisibleIds) seen.add(id);
    }

    return {
      visibleIds: [...seen],
      onShowMissing: () => {
        for (const { panelId, controls, apply } of everyStatsSurface) {
          const missing = listMissingPreferredMetrics(
            loudnessProfile.document,
            controls.statsVisibleIds
          );
          if (missing.length === 0) continue;
          apply(panelId, {
            ...controls,
            statsVisibleIds: planShowMissing(controls.statsVisibleIds, missing),
          });
        }
      },
    };
  }, [
    statsPanelIds,
    dockStatsPanelIds,
    workspaceState,
    dockLayout.controlsByPanelId,
    dockLayout.setPanelControls,
    loudnessProfile.document,
    setPanelControlsForPanel,
  ]);
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumMaxModeUi = normalizedPanelControls.spectrumMaxMode;

  const { intakeRef, frequencyMarkerRef, getSpectrogramSnapsForKey, ingestingIntakes } = routing;

  const {
    histSourceList,
    loudnessDisplayIndex,
    waveformHistoryIndex,
    visualWaveformHist,
    frequencyMarkerIndex,
    displayAudio,
    hasHistoryData,
    correlation,
    channelMetadata,
    targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: intakeRef.current,
    audio,
  });

  const { historyChartInteractive, totalSamples, statsMetrics } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceLufs,
  });

  const hasTpMaxValue = Number.isFinite(displayAudio?.tpMax);
  const vsGridDiagInset = useMemo(() => {
    const pct = UI_PREFERENCES.modules.vectorscope.gridDiagInsetPct ?? 0;
    return Math.max(0, Math.min(20, pct));
  }, []);
  const vsGridDiagFar = 100 - vsGridDiagInset;
  // In file mode the selected history sample's timestamp is absolute media time (>= 0); clamp it so
  // a scrub past the decoded tail never renders a negative time in the transport pill. Live mode
  // keeps the raw value (its timeline is wall-clock relative).
  const fileDurationMs = fileSession.summary?.durationMs ?? fileSession.metadata?.durationMs;
  const selectedMediaTimeMs =
    sourceMode === "file" && Number.isFinite(targetTimestampMs)
      ? Math.max(0, targetTimestampMs)
      : targetTimestampMs;

  // Once a file's duration is known (probe metadata while analyzing, or the final summary), fit the
  // shared time window to the whole file and reset scrub so the full analyzed curve shows over
  // an absolute media-time axis. selectedOffset is intentionally not a dependency so user scrubbing
  // afterwards is preserved; getHistoryViewport clamps the window to [MIN, MAX].
  useEffect(() => {
    if (sourceMode !== "file") return;
    if (fileSession.state !== "analyzing" && fileSession.state !== "complete") return;
    setHistoryWindowSec(
      Number.isFinite(fileDurationMs) ? fileDurationMs / 1000 : historyRetentionSec
    );
    setHistoryOffsetSec(0);
    setSelectedOffset(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, fileSession.state, fileDurationMs, historyRetentionSec]);

  const previousHistoryRetentionSecRef = useRef(historyRetentionSec);
  useEffect(() => {
    if (previousHistoryRetentionSecRef.current === historyRetentionSec) return;
    previousHistoryRetentionSecRef.current = historyRetentionSec;
    setSelectedOffset(-1);
    // Each panel clamps the persisted viewport against the new retention at render time. Keep the
    // stored shared and dormant local values intact so increasing retention can reveal them again.
  }, [historyRetentionSec, setSelectedOffset]);

  const latestTimestampMs = useMemo(() => {
    const last =
      histSourceList.length > 0
        ? typeof histSourceList.rowAt === "function"
          ? histSourceList.rowAt(histSourceList.length - 1)
          : histSourceList[histSourceList.length - 1]
        : null;
    return Number.isFinite(last?.timestampMs) ? last.timestampMs : undefined;
    // The history ring mutates in place; its version is an intentional cache invalidator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histSourceList, histSourceList.version]);

  const sourceTransportState = deriveSourceTransportState({
    sourceMode,
    running,
    selectedOffset,
    latestTimestampMs,
    elapsedMs: elapsedMsRef.current,
    selectedSnapshotTimeMs,
    selectedMediaTimeMs,
    fileSession,
    analyzingFileSession,
  });
  const showFileAnalysisResult = sourceMode === "file" && fileSessions.length > 0;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;
  const dockPanelInstances = useMemo(
    () =>
      dockLayout.panels.map((panel) => ({
        panelId: panel.id,
        moduleId: panel.moduleId,
        controls: dockLayout.controlsByPanelId[panel.id],
      })),
    [dockLayout.panels, dockLayout.controlsByPanelId]
  );
  const derivedAnalysisRequests = useMemo(
    () =>
      mergeDockAnalysisRequests(
        deriveAnalysisRequests(workspaceState, { channelCount }),
        docked ? dockPanelInstances : false
      ),
    [workspaceState, channelCount, docked, dockPanelInstances]
  );
  const analysisRequests = useMemo(
    () => deriveBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  // Which histories survive is a different question from what Rust computes, so this is derived
  // from the open panels rather than from `analysisRequests` -- and deliberately without `docked`,
  // because AppShell renders the strip or the panels and whichever is hidden comes back intact.
  const retainedAnalysisKeys = useMemo(
    () => mergeDockRetainedKeys(deriveRetainedAnalysisKeys(workspaceState), dockPanelInstances),
    [workspaceState, dockPanelInstances]
  );
  // Sweeping runs inside pushVisualHistRow -- i.e. only on the intakes that INGEST frames
  // (routing's `ingestingIntakes`: live + file-analysis), not on `intakeRef.current`, which is
  // whichever intake is DISPLAYED. Those differ across a source switch, and `intakeRef` is a
  // stable ref object, so an effect keyed on it would never re-fire when only its `.current`
  // changes -- go live, switch to file, edit panels there, switch back, and the live intake is
  // still holding the key set from before the excursion (switchSource resets its rows but not
  // `_retainedVisualKeys`). It then ingests under the newly-keyed panel and, a grace period later,
  // sweeps that panel's history away as unretained. Target the ingesting intakes directly instead,
  // so the set follows what is actually writing rows. `fileDisplayIntake` needs nothing of its
  // own: it is either the same object as `fileAnalysisIntake`, or a frozen session that receives
  // no frames and therefore never sweeps.
  useEffect(() => {
    const windowMs = historyRetentionSec * 1000;
    for (const intake of ingestingIntakes) {
      intake?.setRetainedVisualKeys(retainedAnalysisKeys, windowMs);
    }
  }, [ingestingIntakes, retainedAnalysisKeys, historyRetentionSec]);
  const historyPerformanceControllerRef = useRef(null);
  const historyPerformanceRequestKeysRef = useRef(null);
  historyPerformanceRequestKeysRef.current = {
    spectrumKeys: analysisRequests.spectrum.map((request) => request.key),
    vectorscopeKeys: analysisRequests.vectorscope.map((request) => request.key),
    stereoMapKeys: analysisRequests.stereoMap.map((request) => request.key),
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const options = historyPerformanceHarnessOptionsFromSearch(window.location.search);
    if (!options.enabled) return undefined;
    // `npm run dev` is browser-only and has no Tauri capture. Keep this harness out of the
    // desktop runtime so a query parameter can never compete with the real audio engine.
    if (isTauri()) return undefined;
    let disposed = false;
    void import("./dev/historyPerformanceHarness.js").then(({ startHistoryPerformanceHarness }) => {
      if (disposed) return;
      historyPerformanceControllerRef.current = startHistoryPerformanceHarnessController({
        start: startHistoryPerformanceHarness,
        intake: intakeRef.current,
        fullVisual: options.fullVisual,
        requestKeys: historyPerformanceRequestKeysRef.current,
        publishAudio: (nextAudio) => setAudio((current) => ({ ...current, ...nextAudio })),
      });
    });
    return () => {
      disposed = true;
      historyPerformanceControllerRef.current?.cancel();
      historyPerformanceControllerRef.current = null;
    };
  }, [intakeRef, setAudio]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const options = historyPerformanceHarnessOptionsFromSearch(window.location.search);
    if (!options.enabled || isTauri()) return;
    updateHistoryPerformanceHarnessController(
      historyPerformanceControllerRef.current,
      historyPerformanceRequestKeysRef.current
    );
  }, [analysisRequests]);
  const layoutResolution = useMemo(
    () => resolveChannelLayout("auto", { channelCount }),
    [channelCount]
  );
  const channelLabelRuntime = useMemo(
    () => deriveChannelLabelRuntime({ channelCount, layoutResolution, channelLabelOverrides }),
    [channelCount, channelLabelOverrides, layoutResolution]
  );
  const { channelLabelOverride, loudnessWeights } = channelLabelRuntime;
  const { dialogueGating } = useMemo(() => deriveDialogueRuntime(workspaceState), [workspaceState]);
  const agentControlAnalysisContext = useMemo(
    () => {
      const first =
        histSourceList.length > 0
          ? typeof histSourceList.rowAt === "function"
            ? histSourceList.rowAt(0)
            : histSourceList[0]
          : null;
      const measuredDurationSec =
        Number.isFinite(first?.timestampMs) && Number.isFinite(latestTimestampMs)
          ? Math.max(0, (latestTimestampMs - first.timestampMs) / 1000)
          : 0;
      const availableDurationSec =
        sourceMode === "file" && Number.isFinite(fileDurationMs)
          ? Math.min(historyRetentionSec, fileDurationMs / 1000)
          : Math.min(historyRetentionSec, measuredDurationSec);
      return {
        channelCount,
        channelLabels: channelLabelRuntime.channelAutoLabels,
        dialogueDetectionActive: dialogueGating,
        spectralWaveformActive: derivedAnalysisRequests.spectralWaveform,
        timeMaxWindowSec: Math.max(60, availableDurationSec),
        timeMaxOffsetSec: Math.max(0, availableDurationSec - 5),
      };
    },
    // The history ring mutates in place; its version intentionally invalidates this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      channelCount,
      channelLabelRuntime.channelAutoLabels,
      dialogueGating,
      derivedAnalysisRequests.spectralWaveform,
      fileDurationMs,
      histSourceList,
      histSourceList.version,
      historyRetentionSec,
      latestTimestampMs,
      sourceMode,
    ]
  );
  const agentControlSettingsContext = useMemo(
    () => ({
      autostartReady: settings.autostartReady,
      clearShortcutReady: settings.clearReady,
      clearShortcutCapturing: settings.clearCapturing,
      clearShortcutRegistrationError: settings.registrationError,
      themeOptions: [
        ...Object.values(BUILTIN_THEMES_V2).map(({ id, name }) => ({
          id,
          name,
          kind: "builtin",
        })),
        ...Object.values(settings.customThemes ?? {}).map(({ id, name }) => ({
          id,
          name,
          kind: "custom",
        })),
      ],
      activeEditors: activeBlockingEditors,
      dialogueDetectionRequested: dialogueGating,
      dialogueDetectionActive: dialogueGating && running,
      sourceMode,
      channelCount,
      channelLabelMode: channelLabelOverride ? "custom" : "auto",
      channelLabelRoles: channelLabelRuntime.channelLabelTokens,
    }),
    [
      activeBlockingEditors,
      channelCount,
      channelLabelOverride,
      channelLabelRuntime.channelLabelTokens,
      dialogueGating,
      running,
      settings.autostartReady,
      settings.clearCapturing,
      settings.clearReady,
      settings.customThemes,
      settings.registrationError,
      sourceMode,
    ]
  );
  const agentControlSettings = useMemo(
    () => buildPublicSettings(settings, agentControlSettingsContext),
    [agentControlSettingsContext, settings]
  );
  useAgentControlBridge({
    enabled: agentControlRuntime.available === true,
    runtime: agentControlRuntime,
    workspace: workspaceState,
    replaceWorkspace,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    presets,
    settings: agentControlSettings,
    settingsContext: agentControlSettingsContext,
    loudnessProfiles: loudnessProfile.profiles,
    hasLoudnessReference: Number.isFinite(loudnessProfile.referenceLufs),
    analysisContext: agentControlAnalysisContext,
  });
  const dialogueVadEngine = settings.dialogueVadEngine;
  const channelAutoLabels = channelLabelRuntime.channelAutoLabels;
  const channelLabelTokens = channelLabelRuntime.channelLabelTokens;
  const { loudnessWeightsRef, dialogueGatingRef, dialogueVadEngineRef } = useRuntimeBackendSync({
    analysisRequests,
    loudnessWeights,
    running,
    dialogueGating,
    dialogueVadEngine,
  });

  useEffect(() => {
    const s = document.documentElement.style;
    const p = panelOpacity;
    s.setProperty("--panel-opacity", `${p}%`);
    s.setProperty("--panel-opacity-card", `${Math.round(p * 0.55)}%`);
    s.setProperty("--panel-opacity-header", `${Math.round(p * 0.6)}%`);
    s.setProperty("--panel-opacity-meter", String(Math.max(0.25, p / 100)));
  }, [panelOpacity]);

  const currentFileAnalysisSettings = useCallback(
    () => ({
      dialogue: {
        enabled: dialogueGating,
        engine: dialogueGating ? dialogueVadEngine : null,
      },
    }),
    [dialogueGating, dialogueVadEngine]
  );

  const peakLabelContext = channelLabelRuntime.peakLabelContext;

  const setChannelLabelToken = useCallback(
    (index, token) => {
      if (channelCount <= 0) return;
      setChannelLabelOverrides((prev) => {
        const base = prev[channelCount] ?? seedTokensFromLabels(channelAutoLabels);
        const next = base.slice();
        next[index] = token;
        return { ...prev, [channelCount]: next };
      });
    },
    [channelCount, channelAutoLabels, setChannelLabelOverrides]
  );

  const resetChannelLabels = useCallback(() => {
    setChannelLabelOverrides((prev) => {
      if (!(channelCount in prev)) return prev;
      const next = { ...prev };
      delete next[channelCount];
      return next;
    });
  }, [channelCount, setChannelLabelOverrides]);

  /** Use stereo (2ch) choices when idle so Settings shows default L/R instead of an empty state. */
  const vectorscopePairOptions = useMemo(() => {
    const n = channelCount >= 2 ? channelCount : channelCount === 0 ? 2 : 1;
    return buildVectorscopePairOptions(n, peakLabelContext);
  }, [channelCount, peakLabelContext]);

  const spectrumChannelOptions = useMemo(() => {
    const n = channelCount >= 2 ? channelCount : 2;
    const labels = getPeakMeterChannelLabels(n, peakLabelContext);
    return buildSpectrumChannelOptions(n, labels);
  }, [channelCount, peakLabelContext]);
  const spectrumValueKey =
    spectrumChannelUi.type === "pair"
      ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
      : `s-${spectrumChannelUi.ch}`;
  const spectrumLiveLabel =
    spectrumChannelOptions.find((o) => o.key === spectrumValueKey)?.label ??
    spectrumChannelOptions[0]?.label ??
    "L/R";
  const vectorscopeValueKey = `${vectorscopePairUi.x}-${vectorscopePairUi.y}`;
  const vectorscopeChannelLabels = getPeakMeterChannelLabels(
    channelCount >= 2 ? channelCount : 2,
    peakLabelContext
  );
  const vectorscopeLiveLabel = formatVectorscopePairLabel({
    x: vectorscopePairUi.x,
    y: vectorscopePairUi.y,
    channelLabels: vectorscopeChannelLabels,
  });
  const spectrumDisplayLabel = channelMetadata?.frequencyLabel ?? spectrumLiveLabel;
  const vectorscopeDisplayLabel = channelMetadata?.vectorscopePairLabel ?? vectorscopeLiveLabel;

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (captureDeviceId === "default") {
      return defaultOutputFormatSig || "";
    }
    const d = audioDevices.find((x) => x.id === captureDeviceId);
    return d ? `${d.channels}:${d.defaultSampleRate}` : "";
  }, [captureDeviceId, audioDevices, defaultOutputFormatSig]);

  const deviceName = useMemo(() => {
    if (!isTauri()) return null;
    if (captureDeviceId === "default") {
      return defaultOutputLabel || audioDevices.find((d) => d.isSystemOutputMonitor)?.label || null;
    }
    return audioDevices.find((d) => d.id === captureDeviceId)?.label ?? null;
  }, [captureDeviceId, audioDevices, defaultOutputLabel]);
  const deviceDisplay = useMemo(
    () => (deviceName ? formatAudioDeviceLabel(deviceName) : null),
    [deviceName]
  );
  const footerDeviceLabel = deviceDisplay
    ? deviceDisplay.secondary || deviceDisplay.primary
    : "Not connected";
  const activePreset = presets.list.find((preset) => preset.id === presets.activeId);
  const activePresetName = activePreset ? `${activePreset.name}${presets.dirty ? " *" : ""}` : "-";
  const focusViewActive =
    pinned ||
    focusView.autoHideControls ||
    focusView.compactPanels ||
    focusView.borderless ||
    panelOpacity < 100;
  const frameless = focusView.autoHideControls || focusView.borderless;
  const {
    controlsVisible: focusControlsVisible,
    showControls: showFocusControls,
    hideControlsLater: hideFocusControlsLater,
    hideControlsNow: hideFocusControlsNow,
    toggleControls: toggleFocusControls,
    holdControls: holdFocusControls,
    releaseControlsHold: releaseFocusControlsHold,
    handleWindowDrag,
  } = useViewsChromeReveal({
    autoHideControls: focusView.autoHideControls,
    frameless,
  });

  // Clamp every panel instance's channel selection to the currently available channels. Lowering
  // the device channel count must repair all panels (not just the first), otherwise a stale
  // out-of-range selection would derive an analysis request key with no matching backend result.
  useEffect(() => {
    const updates = deriveClampedPanelControls(workspaceState, {
      spectrumChannelOptions,
      channelCount,
      peakLabelContext,
    });
    for (const { panelId, panelControls } of updates) {
      setPanelControlsForPanel(panelId, panelControls);
    }
  }, [
    workspaceState,
    spectrumChannelOptions,
    channelCount,
    peakLabelContext,
    setPanelControlsForPanel,
  ]);

  const dockPanels = dockLayout.panels;
  const dockControlsByPanelId = dockLayout.controlsByPanelId;
  const setDockPanelControls = dockLayout.setPanelControls;

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "vectorscope") continue;
      const controls = dockControlsByPanelId[panel.id];
      const pair = controls?.vectorscopePair;
      const nextPair = clampVectorscopePairToAvailable(
        pair,
        channelCount >= 2 ? channelCount : 2,
        peakLabelContext
      );
      if (nextPair.x === pair?.x && nextPair.y === pair?.y) continue;
      setDockPanelControls(panel.id, { ...controls, vectorscopePair: nextPair });
    }
  }, [channelCount, dockControlsByPanelId, dockPanels, setDockPanelControls, peakLabelContext]);

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "stereo-map") continue;
      const controls = dockControlsByPanelId[panel.id];
      const pair = controls?.stereoMapPair;
      const nextPair = clampVectorscopePairToAvailable(
        pair,
        channelCount >= 2 ? channelCount : 2,
        peakLabelContext
      );
      if (nextPair.x === pair?.x && nextPair.y === pair?.y) continue;
      setDockPanelControls(panel.id, { ...controls, stereoMapPair: nextPair });
    }
  }, [channelCount, dockControlsByPanelId, dockPanels, setDockPanelControls, peakLabelContext]);

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "spectrum" && panel.moduleId !== "spectrogram") continue;
      const controls = dockControlsByPanelId[panel.id];
      const channel = controls?.spectrumChannel;
      const nextChannel = clampSpectrumChannelToAvailable(channel, spectrumChannelOptions);
      const currentKey =
        channel?.type === "single" ? `s-${channel.ch}` : `p-${channel?.x ?? 0}-${channel?.y ?? 1}`;
      const nextKey =
        nextChannel.type === "single"
          ? `s-${nextChannel.ch}`
          : `p-${nextChannel.x}-${nextChannel.y}`;
      if (currentKey === nextKey) continue;
      setDockPanelControls(panel.id, { ...controls, spectrumChannel: nextChannel });
    }
  }, [dockControlsByPanelId, dockPanels, setDockPanelControls, spectrumChannelOptions]);

  const captureCurrentSnapshot = useCallback(() => {
    if (!historyChartInteractive || totalSamples <= 0) return;
    setSelectedOffset(0);
  }, [historyChartInteractive, totalSamples, setSelectedOffset]);

  const resetTpMax = async () => {
    if (isTauri()) {
      try {
        await resetTruePeakMax();
      } catch (_) {}
    }
    setAudio((prev) => ({ ...prev, tpMax: -Infinity }));
  };

  const { exportFileAnalysisReport } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    raiseNotice,
  });
  const {
    clearAll,
    openFile,
    onSelectFile,
    onStopFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    handleDropFile,
    onStartClick,
    onSourceTransportAction,
    onSourceModeChange,
  } = useSourceTransportActions({
    sourceMode,
    running,
    selectedOffset,
    setSelectedOffset,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    startLive,
    stopLive,
    switchSource,
    clearActiveSource,
    beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
    stopFileAnalysis,
    activeFileSession,
    getFileAnalysisSettings: currentFileAnalysisSettings,
    onClearSucceeded: () => {
      setVectorscopeResetEpoch((epoch) => epoch + 1);
      setStereoMapResetEpoch((epoch) => epoch + 1);
    },
  });
  onClearRef.current = clearAll;
  useDialogueEngineRestart(dialogueVadEngine, dialogueGating, onClearRef);

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
    active: docked && !dockSuspended,
    edge: dockEdge,
    geometryVersion: dockHeight,
    forceHeaderVisible: notice?.kind === "error",
    onError: onDockAccessoryError,
  });
  const [hoveredDockPanelId, setHoveredDockPanelId] = useState(null);
  const onDockHeightChange = useCallback(
    async (height, options) => {
      clearNotice();
      try {
        await resizeDockHeight(height, options);
      } catch (error) {
        raiseNotice(
          "error",
          "Dock height could not be changed. The previous height was kept.",
          errorDetails("Dock resize failed", error)
        );
      }
    },
    [clearNotice, raiseNotice, resizeDockHeight]
  );
  const dockHeaderState = useMemo(
    () => ({
      sourceTransportState,
      clearDisabled: !running && !showClock,
      notice,
      edge: dockEdge,
      reserveSpace,
      editorView: dockAccessoryVisibility.editorView,
      // Mirrors the normal-mode toolbar's Presets highlight (see AppHeader.jsx): a preset is
      // "active" once applied and untouched since, matching the Loudness/Views semantic rather
      // than the editor's own open/closed pressed state below.
      activeCleanPreset: presets.activeId != null && !presets.dirty,
    }),
    [
      dockAccessoryVisibility.editorView,
      dockEdge,
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
      view: dockAccessoryVisibility.editorView,
      panels: dockLayout.panels,
      panelsById: dockLayout.panelsById,
      panelOrder: dockLayout.panelOrder,
      controlsByPanelId: dockLayout.controlsByPanelId,
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
    }),
    [
      dockAccessoryVisibility.editorView,
      dockLayout.controlsByPanelId,
      dockLayout.panelOrder,
      dockLayout.panels,
      dockLayout.panelsById,
      channelCount,
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
      if (type === "source-primary") onSourceTransportAction(payload.actionKind);
      else if (type === "clear") clearAll();
      else if (type === "open-editor") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.openEditor(payload.view, payload.anchorX);
      } else if (type === "close-editor") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.closeEditor(payload.view, payload.reason);
      } else if (type === "resize-editor") dockAccessoryVisibility.resizeEditor(payload);
      else if (type === "set-edge") void onDockChange(payload.edge);
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
          .catch((error) => reportSceneOperationError(error, "Preset failed.", "Preset failed"));
      } else if (type === "save-preset") {
        void presets
          .save(payload.name)
          .catch((error) => reportSceneOperationError(error, "Preset failed.", "Preset failed"));
      } else if (type === "update-preset") {
        void presets
          .update(payload.presetId)
          .catch((error) => reportSceneOperationError(error, "Preset failed.", "Preset failed"));
      } else if (type === "rename-preset") presets.rename(payload.presetId, payload.name);
      else if (type === "delete-preset") presets.remove(payload.presetId);
      else if (type === "reorder-preset") presets.reorder(payload.presetIds);
    },
    [
      clearAll,
      clearNotice,
      dockAccessoryVisibility,
      dockLayout,
      exitDockRestoringAttributes,
      onDockChange,
      onSourceTransportAction,
      presets,
      raiseNotice,
      reportSceneOperationError,
      reserveSpace,
      toggleReserveSpace,
    ]
  );
  useDockAccessoryBridge({
    active: docked,
    headerState: dockHeaderState,
    editorState: dockEditorState,
    onAction: onDockAccessoryAction,
    onPointer: dockAccessoryVisibility.onAccessoryPointer,
  });

  useTray({
    running,
    onStartClick,
    onToggleWindow,
    colorScheme: resolvedTheme.colorScheme,
    updateBusy,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectDevice: setCaptureDeviceIdAndPersist,
    presets,
  });

  useAppKeyboardShortcuts({
    clearAll,
    running,
    showClock,
    // Settings dialog is normal-form only; ignore the shortcut while docked so
    // exiting dock doesn't pop a dialog opened invisibly from the strip.
    setSettingsOpen: docked ? () => {} : setSettingsOpen,
    clearShortcut,
    autoHideControls: focusView.autoHideControls,
    toggleFocusControls,
  });

  useEffect(() => {
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
  }, [intakeRef, spectrumLiveLabel, vectorscopeLiveLabel]);

  const spectrumViewLegendValue = useMemo(
    () => spectrumViewLegend(spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels),
    [spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels]
  );
  const panelChromeData = useMemo(
    () => ({
      compactPanels: focusView.compactPanels,
      channelCount,
      vectorscopePairOptions,
      vectorscopeValueKey,
      vectorscopeDisplayLabel,
      stereoMapPairOptions: vectorscopePairOptions,
      stereoMapPairValueKey: vectorscopeValueKey,
      stereoMapPairDisplayLabel: vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumValueKey,
      spectrumDisplayLabel,
      spectrumView: spectrumViewUi,
      spectrumViewLegend: spectrumViewLegendValue,
      spectrumMaxMode: spectrumMaxModeUi,
    }),
    [
      focusView.compactPanels,
      channelCount,
      vectorscopePairOptions,
      vectorscopeValueKey,
      vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumValueKey,
      spectrumDisplayLabel,
      spectrumViewUi,
      spectrumViewLegendValue,
      spectrumMaxModeUi,
    ]
  );

  const frameData = {
    // Peak
    displayAudio,
    hasTpMaxValue,
    onResetTpMax: resetTpMax,
    // Vectorscope
    vsGridDiagInset,
    vsGridDiagFar,
    correlation,
    vectorscopePairX: vectorscopePairUi.x,
    vectorscopePairY: vectorscopePairUi.y,
    channelCount,
    peakLabelContext,
    resolvedThemeId,
    spectrumChannelOptions,
  };
  const historyData = {
    selectedOffset,
    setSelectedOffset,
    // The Time Range settings row edits the viewport these describe. It reads the effective values
    // rather than the stored window, because those are what the axis labels are built from.
    sourceMode,
    historyMaxWindowSec: historyRetentionSec,
    historyWindowSec: sharedTimeViewport.windowSec,
    historyOffsetSec: sharedTimeViewport.offsetSec,
    setHistoryWindowSec,
    setHistoryOffsetSec,
    running,
    referenceLufs,
    momentaryRules: loudnessTraceRules.momentary,
    shortTermRules: loudnessTraceRules.shortTerm,
    hasHistoryData,
    historyChartInteractive,
    captureCurrentSnapshot,
    frequencyMarkerRef,
    frequencyMarkerIndex,
    totalSamples,
    histSourceList,
    loudnessDisplayIndex,
    waveformHistoryIndex,
    visualWaveformHist,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
    getVectorscopeHistoryForKey: (key) => intakeRef.current.getVisualVectorscopeHistByKey(key),
    getStereoMapHistoryForKey: (key) => intakeRef.current.getVisualStereoMapHistByKey(key),
    vectorscopeResetEpoch,
    stereoMapResetEpoch,
    getSpectrogramSnapsForKey,
  };
  // frameData/historyData change at frame/history-sample rate by nature, so memoizing
  // them buys nothing; the low-frequency layers are metricsData (below), panelChromeData
  // and the memoized runtime object in MeterRuntimeContext.
  const dialogueActiveNow = displayAudio?.dialogueActiveNow ?? false;
  const metricsData = useMemo(
    () => ({ statsMetrics, dialogueActiveNow }),
    [statsMetrics, dialogueActiveNow]
  );
  // Live and file sessions share bounded display history, sized from the user's History Length
  // setting. File-mode summary metrics are authoritative for the whole file; panel history is an
  // inspectable downsampled/session view, not unlimited storage.
  const runtimeEnginesProps = {
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples,
    visualMaxSamples,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
  };
  const fileDropProps = {
    active: sourceMode === "file",
    onDropFile: handleDropFile,
  };
  const shellHandlers = {
    showFocusControls,
    hideFocusControlsNow,
    hideFocusControlsLater,
    handleWindowDrag,
    releaseFocusControlsHold,
  };
  const headerProps = {
    autoHideControls: focusView.autoHideControls,
    onPointerEnter: focusView.autoHideControls ? showFocusControls : undefined,
    onPointerLeave: focusView.autoHideControls ? hideFocusControlsLater : undefined,
    onPointerDown: frameless ? handleWindowDrag : undefined,
    onPointerUp: frameless ? releaseFocusControlsHold : undefined,
    onPointerCancel: frameless ? releaseFocusControlsHold : undefined,
    sourceTransportState,
    notice,
    sourceMode,
    onSourceModeChange,
    onSourceTransportAction,
    onClear: clearAll,
    clearDisabled: sourceMode === "file" ? !activeFileSession : !running && !showClock,
    isTauriApp: isTauri(),
    onOpenFile: openFile,
    audioDevices,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    setCaptureDeviceId: setCaptureDeviceIdAndPersist,
    holdFocusControls,
    focusView,
    focusViewActive,
    pinned,
    setPinned,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    showDock: isTauri() && supportsDockMode(),
    dockEdge: docked ? dockEdge : null,
    onDockChange,
    dockDisabled: sourceMode === "file",
    presets,
    loudnessProfile,
    loudnessProfileStats,
    setSettingsOpen,
  };
  const fileSummaryProps = {
    fileSession,
    fileSessions,
    activeFileId,
    analyzingFileId,
    onSelectFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    onStopFile,
    onExportReport: exportFileAnalysisReport,
  };
  const footer = {
    deviceLabel: footerDeviceLabel,
    // The draft outranks the selection, so a profile being edited names the footer too. An
    // unnamed new profile reads Untitled, matching normalizeRuleDocument's fallback.
    loudnessProfileName: loudnessProfile.document
      ? loudnessProfile.document.name || "Untitled"
      : null,
    activePresetName,
    hasUpdate: updateInfo?.hasUpdate,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const dockProps = docked
    ? {
        panels: dockLayout.panels,
        panelSizesById: dockLayout.panelSizesById,
        hoveredPanelId:
          dockAccessoryVisibility.editorView === "modules" ? hoveredDockPanelId : null,
        onPointerEnter: dockAccessoryVisibility.onStripPointerEnter,
        onPointerLeave: dockAccessoryVisibility.onStripPointerLeave,
        edge: dockEdge,
        height: dockPreviewHeight ?? dockHeight,
        heightResizeDisabled: dockAccessoryVisibility.editorView !== null,
        panelResizeDisabled: dockAccessoryVisibility.editorView !== null,
        onHeightChange: onDockHeightChange,
        onPanelResize: dockLayout.resizePanelPair,
        onPanelResizeReset: dockLayout.resetPanelPair,
        controls: {
          controlsByPanelId: dockLayout.controlsByPanelId,
          ...dockHistoryViewport,
          sourceTransportState,
          onSourceTransportAction,
          notice,
        },
      }
    : null;

  return (
    <AppShell
      docked={docked}
      dockProps={dockProps}
      frameData={frameData}
      historyData={historyData}
      metricsData={metricsData}
      runtimeEnginesProps={runtimeEnginesProps}
      fileDropProps={fileDropProps}
      focusView={focusView}
      focusControlsVisible={focusControlsVisible}
      shellHandlers={shellHandlers}
      headerProps={headerProps}
      showFileAnalysisResult={showFileAnalysisResult}
      fileSummaryProps={fileSummaryProps}
      panelChromeData={panelChromeData}
      footer={footer}
    >
      <AppSettingsOverlays
        settings={settings}
        loudnessProfile={loudnessProfile}
        channelSettings={{
          channelCount,
          channelLabelTokens,
          channelLabelHasOverride: !!channelLabelOverride,
          setChannelLabelToken,
          resetChannelLabels,
        }}
        updateControls={{
          updateInfo,
          refreshUpdateCheck,
          installStatus,
          install,
          restartToApply,
          resetInstall,
        }}
        appVersion={APP_VERSION}
      />

      <CloseConfirmDialog
        open={closeDialogOpen}
        onConfirm={handleCloseConfirm}
        onCancel={handleCloseCancel}
      />
    </AppShell>
  );
}
