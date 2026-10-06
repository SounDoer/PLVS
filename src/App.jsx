import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import {
  MeterRuntimeProvider,
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./runtime/MeterRuntimeContext.jsx";
import {} from "./runtime/appRuntimeDerivations.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { normalizePanelControls } from "./lib/panelControls.js";
import {
  useLoudnessHistory,
  HIST_SAMPLE_SEC,
  VISUAL_HIST_SAMPLE_SEC,
} from "./hooks/useLoudnessHistory.js";
import { SettingsProvider, useAppSettings } from "./settings/SettingsContext.jsx";
import { LoudnessProfileProvider, useLoudnessProfile } from "./hooks/LoudnessProfileContext.jsx";
import { LOUDNESS_PROFILE_OFF } from "./lib/loudnessProfileCatalog.js";
import { BlockingEditorsProvider } from "./hooks/BlockingEditorsContext.jsx";
import { SceneGuardProvider, useSceneGuard } from "./hooks/SceneGuardContext.jsx";
import { errorDetails } from "./lib/errorDetails.js";
import { reportSceneOperationError } from "./lib/sceneOperationNotice.js";
import {
  UiNavigationProvider,
  useUiNavigationTarget,
  useUiSurface,
} from "./uiNavigation/UiNavigationContext.jsx";
import { preparePanelSettingsNavigation } from "./uiNavigation/panelSettingsNavigation.js";
import { DockProvider, useDock } from "./dock/DockContext.jsx";
import { WindowChromeProvider, useWindowChrome } from "./hooks/WindowChromeContext.jsx";
import { PresetsProvider, usePresetLibrary } from "./hooks/PresetsContext.jsx";
import { SourceProvider, useSource } from "./runtime/SourceContext.jsx";
import { SourceActionsProvider, useSourceActions } from "./runtime/SourceActionsContext.jsx";
import { AppLifecycleProvider, useAppLifecycle } from "./hooks/AppLifecycleContext.jsx";
import { DisplaySnapshotProvider, useDisplaySnapshot } from "./runtime/DisplaySnapshotContext.jsx";
import { AnalysisSessionProvider, useAnalysisSession } from "./runtime/AnalysisSessionContext.jsx";
import { useLoudnessProfileStats } from "./hooks/useLoudnessProfileStats.js";
import { useSharedTimeViewport } from "./workspace/useSharedTimeViewport.js";
import { useDockAccessoryBridge } from "./dock/useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./dock/useDockAccessoryVisibility.js";
import { formatVectorscopePairLabel } from "./math/vectorscopePairMath.js";
import {} from "./math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { roleTokensToLabels } from "./math/channelRoles.js";
import { standardLayoutIdForCount } from "./math/channelLayoutTable.js";
import { AppShell } from "./components/AppShell.jsx";
import { AppSettingsOverlays } from "./components/AppSettingsOverlays.jsx";
import { usePackTransfer } from "./transfer/usePackTransfer.js";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
import { supportsDockMode } from "./lib/platform.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { isTauri } from "./ipc/env.js";
import { isParticipantInstance } from "./lib/runtimeRole.js";
import {
  captureVisualScreenshot,
  getVisualCaptureCapabilities,
  inspectVisualRecording,
  resetTruePeakMax,
  startVisualRecording,
  stopVisualRecording,
  updateVisualRecordingAudioState,
  updateVisualRecordingGeometry,
} from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { useAppGlobalEffects } from "./hooks/useAppGlobalEffects.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import { LibraryConflictDialog } from "./components/LibraryConflictDialog.jsx";
import packageInfo from "../package.json";
import { readAgentControlRuntime } from "./agentControl/appSnapshot.js";
import { AgentControlBridge } from "./agentControl/AgentControlBridge.jsx";
import { useVisualCaptureSurfaces } from "./agentControl/useVisualCaptureSurfaces.js";

const APP_VERSION = packageInfo.version;
const DevUiVisualFixture = import.meta.env.DEV
  ? lazy(() => import("./dev/UiVisualFixture.jsx"))
  : null;

function nextPaint(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      cancelAnimationFrame(frame);
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
    };
    const frame = requestAnimationFrame(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function settleDockAccessory(target, runtime, options) {
  const geometry = runtime?.accessoryGeometry?.[target.kind];
  if (!geometry?.visible || !(geometry.width > 0 && geometry.height > 0)) {
    throw Object.assign(new Error("The requested Dock accessory is unavailable."), {
      reason: "targetUnavailable",
    });
  }
  await document.fonts?.ready;
  await nextPaint(options.signal);
  await nextPaint(options.signal);
  const revision = options.getRevision();
  if (options.expectedRevision !== undefined && revision !== options.expectedRevision) {
    throw Object.assign(new Error("The Agent Control revision changed before capture."), {
      reason: "revisionConflict",
      details: { expectedRevision: options.expectedRevision, currentRevision: revision },
    });
  }
  const uiGeneration = options.getUiGeneration?.() ?? 0;
  if (options.expectedUiGeneration !== undefined && uiGeneration !== options.expectedUiGeneration) {
    throw Object.assign(new Error("The visible UI changed before capture."), {
      reason: "uiGenerationConflict",
      details: {
        expectedUiGeneration: options.expectedUiGeneration,
        currentUiGeneration: uiGeneration,
      },
    });
  }
  const viewport = { width: geometry.width, height: geometry.height };
  return {
    target,
    windowLabel: target.kind === "dockHeader" ? "dock-header" : "dock-editor",
    rect: { x: 0, y: 0, ...viewport },
    viewport,
    devicePixelRatio: window.devicePixelRatio || 1,
    revision,
    uiGeneration,
  };
}

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

// The provider order is the dependency order: a provider may read the ones that enclose it and
// never one it encloses. Each line says what the provider reads, so a new owner has one obvious
// place to go.
export default function App() {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        {/* Outside LoudnessProfileProvider and SettingsProvider: the profile draft and the theme
            editor both register themselves as blocking editors. */}
        <BlockingEditorsProvider>
          {/* Reads BlockingEditors. */}
          <UiNavigationProvider>
            {/* Outside DockProvider: the strip's Stats and the main window's read one profile. */}
            <LoudnessProfileProvider>
              {/* Reads BlockingEditors and UiNavigation (the theme editor registers with both). */}
              <SettingsProvider>
                {/* Reads BlockingEditors and MeterRuntime (source mode). */}
                <SceneGuardProvider>
                  {/* Reads Settings (the values exit restores) and SceneGuard. */}
                  <DockProvider>
                    {/* Reads Settings and Dock: its window effects stand down while docked. */}
                    <WindowChromeProvider>
                      {/* Reads Workspace, Settings, Dock, LoudnessProfile and SceneGuard: everything
                          a preset captures or replaces. */}
                      <PresetsProvider>
                        {/* Reads MeterRuntime. */}
                        <SourceProvider>
                          {/* Reads MeterRuntime, Workspace, Settings and LoudnessProfile; assigns
                              the clear ref Settings owns. */}
                          <SourceActionsProvider>
                            {/* Reads Settings, Dock, WindowChrome, Presets, Source and
                                SourceActions. */}
                            <AppLifecycleProvider>
                              {/* Reads MeterRuntime. Its value changes per meter frame. */}
                              <DisplaySnapshotProvider>
                                {/* Reads DisplaySnapshot, Workspace, Dock, Settings and
                                    SourceActions. */}
                                <AnalysisSessionProvider>
                                  <AppContent />
                                </AnalysisSessionProvider>
                              </DisplaySnapshotProvider>
                            </AppLifecycleProvider>
                          </SourceActionsProvider>
                        </SourceProvider>
                      </PresetsProvider>
                    </WindowChromeProvider>
                  </DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

function AppContent() {
  const meterRuntime = useMeterRuntime();
  const {
    notice,
    raiseNotice,
    clearNotice,
    selectedOffset,
    setSelectedOffset,
    selectedSnapshotTimeMs,
    showClock,
  } = useMeterDisplayState();
  const { state: workspaceState, setActiveTab } = useWorkspaceStore();
  const visualCaptureSurfaces = useVisualCaptureSurfaces({ workspace: workspaceState });
  const visualRuntimeRef = useRef(null);
  const { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  useAppGlobalEffects();
  const {
    sourceMode,
    running,
    fileSessions,
    activeFileSession,
    analyzingFileSession,
    activeFileId,
    analyzingFileId,
  } = meterRuntime;
  const {
    fileSession,
    dialogueGating,
    exportFileAnalysisReport,
    copyFileAnalysisReportMarkdown,
    vectorscopeResetEpoch,
    stereoMapResetEpoch,
    clearAll,
    openFile,
    onSelectFile,
    onStopFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    handleDropFile,
    onSourceTransportAction,
    onSourceModeChange,
  } = useSourceActions();
  const settings = useAppSettings();
  const { windowPinned: pinned } = settings;
  const packTransfer = usePackTransfer();
  const {
    crashReportSetting,
    crashReporting,
    updateControls,
    closeConfirm: {
      dialogOpen: closeDialogOpen,
      closeError,
      closing,
      handleConfirm: handleCloseConfirm,
      handleRetry: handleCloseRetry,
      handleCancel: handleCloseCancel,
    },
  } = useAppLifecycle();
  const {
    setSettingsOpen,
    resolvedThemeId,
    focusView,
    channelLabelOverrides,
    surfaceOpacity,
    glassEnabled,
  } = settings;
  // Hoisted above useDockMode and usePresets: dock entry cancels an open profile
  // draft, and preset capture and apply both need its snapshot helpers. One
  // writer for the reference too - null when Off, which every consumer treats as
  // "there is nothing to show". Reading it this early is safe: it is a context
  // read with no ordering constraints of its own.
  const loudnessProfile = useLoudnessProfile();
  const { activeBlockingEditors } = useSceneGuard();
  const {
    docked,
    dockEdge,
    dockHeight,
    dockPreviewHeight,
    dockSuspended,
    reserveSpace,
    toggleReserveSpace,
    layout: dockLayout,
    historyViewport: dockHistoryViewport,
    exitDockRestoringAttributes,
    onDockChange,
    onDockHeightChange,
  } = useDock();
  const {
    setPinned,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    setSurfaceOpacity,
    setGlassEnabled,
    focusViewActive,
    frameless,
    reveal: {
      controlsVisible: focusControlsVisible,
      showControls: showFocusControls,
      hideControlsLater: hideFocusControlsLater,
      hideControlsNow: hideFocusControlsNow,
      holdControls: holdFocusControls,
      releaseControlsHold: releaseFocusControlsHold,
      handleWindowDrag,
    },
  } = useWindowChrome();

  const {
    audioDevices,
    captureApplications,
    captureDeviceId,
    safeAudioDeviceId,
    refreshInventory,
    audioOutputs,
    audioInputs,
    onSelectCaptureDevice,
    captureFormatSignature,
    footerSourceLabel,
  } = useSource();

  const { display, routing } = useMeterRuntimeAssembly();
  const { setAudio } = display;
  const { elapsedMsRef } = display.clock;

  const reportSceneError = useCallback(
    (error, fallbackMessage, detailPrefix) =>
      reportSceneOperationError(raiseNotice, error, fallbackMessage, detailPrefix),
    [raiseNotice]
  );

  const presets = usePresetLibrary();
  const agentControlRuntime = useMemo(readAgentControlRuntime, []);
  const [visualPlatformCapabilities, setVisualPlatformCapabilities] = useState(null);
  const [visualRecordingState, setVisualRecordingState] = useState(null);
  useEffect(() => {
    if (agentControlRuntime.available !== true) return undefined;
    let cancelled = false;
    getVisualCaptureCapabilities()
      .then((capabilities) => {
        if (!cancelled) setVisualPlatformCapabilities(capabilities);
      })
      .catch(() => {
        if (!cancelled) {
          setVisualPlatformCapabilities({
            platform: agentControlRuntime.platform ?? "unknown",
            screenshot: { available: false, targets: [] },
            recording: { available: false, targets: [], audioSources: [], cursorModes: [] },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentControlRuntime]);
  const [agentControlEnabled, setAgentControlEnabled] = useState(
    () => agentControlRuntime.enabled === true
  );

  const historyRetentionSec = settings.historyRetentionSec;
  const histMaxSamples = Math.round(historyRetentionSec / HIST_SAMPLE_SEC);
  const visualMaxSamples = Math.round(historyRetentionSec / VISUAL_HIST_SAMPLE_SEC);

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

  const loudnessProfileStats = useLoudnessProfileStats();
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumMaxModeUi = normalizedPanelControls.spectrumMaxMode;

  const { intakeRef, frequencyMarkerRef, getSpectrogramSnapsForKey } = routing;

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
    channelCount,
  } = useDisplaySnapshot();

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
  const selectedMediaTimeMs =
    sourceMode === "file" && Number.isFinite(targetTimestampMs)
      ? Math.max(0, targetTimestampMs)
      : targetTimestampMs;

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
  const {
    channelLabelRuntime,
    peakLabelContext,
    setChannelLabelToken,
    setChannelLayout,
    resetChannelLabels,
    vectorscopePairOptions,
    spectrumChannelOptions,
    derivedAnalysisRequests,
    analysisRequests,
    fileDurationMs,
    channelRolesRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
  } = useAnalysisSession();
  const { channelLabelOverride, channelLabelTokens } = channelLabelRuntime;
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
  const measurementChannelLabels = useCallback(
    (record) => {
      const count = Array.isArray(record?.audio?.peakDb) ? record.audio.peakDb.length : 0;
      if (count <= 0) return [];
      const override = channelLabelOverrides[count];
      const autoLayoutId = standardLayoutIdForCount(count);
      return getPeakMeterChannelLabels(count, {
        formatId: autoLayoutId ?? undefined,
        resolvedLayout: autoLayoutId ? undefined : "unknown",
        overrideLabels: override ? roleTokensToLabels(override) : null,
      });
    },
    [channelLabelOverrides]
  );
  const agentControlMeasurementContext = useMemo(
    () => ({
      getLiveMeasurement: meterRuntime.getLiveMeasurement,
      subscribeLiveMeasurement: meterRuntime.subscribeLiveMeasurement,
      getChannelLabels: measurementChannelLabels,
      liveState: meterRuntime.liveLifecycle,
      vectorscopeRequests: analysisRequests.vectorscope,
      dialogueActive: dialogueGating,
    }),
    [
      analysisRequests.vectorscope,
      dialogueGating,
      measurementChannelLabels,
      meterRuntime.getLiveMeasurement,
      meterRuntime.subscribeLiveMeasurement,
      meterRuntime.liveLifecycle,
    ]
  );
  const agentControlVisual = useMemo(
    () => ({
      platformCapabilities: visualPlatformCapabilities,
      getRuntime: () => visualRuntimeRef.current,
      settle: (target, options) =>
        target.kind === "dockHeader" || target.kind === "dockEditor"
          ? settleDockAccessory(target, visualRuntimeRef.current, options)
          : visualCaptureSurfaces.settle(target, options),
      captureScreenshot: captureVisualScreenshot,
      startRecording: startVisualRecording,
      inspectRecording: inspectVisualRecording,
      stopRecording: stopVisualRecording,
      updateRecordingGeometry: updateVisualRecordingGeometry,
      updateRecordingAudioState: updateVisualRecordingAudioState,
      subscribe: visualCaptureSurfaces.subscribe,
      setRecordingState: setVisualRecordingState,
    }),
    [visualCaptureSurfaces, visualPlatformCapabilities]
  );
  const agentControlBridgeProps = {
    enabled:
      agentControlRuntime.available === true &&
      (agentControlEnabled || isParticipantInstance()) &&
      visualPlatformCapabilities !== null,
    runtime: agentControlRuntime,
    dockContext: {
      platform: agentControlRuntime.platform,
      ...agentControlAnalysisContext,
      sourceMode,
      activeEditors: activeBlockingEditors,
    },
    analysisContext: agentControlAnalysisContext,
    measurementContext: agentControlMeasurementContext,
    visual: agentControlVisual,
  };
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

  const activePreset = presets.list.find((preset) => preset.id === presets.activeId);
  const activePresetName = activePreset ? `${activePreset.name}${presets.dirty ? " *" : ""}` : null;
  const dockPanels = dockLayout.panels;
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
        ]
      : ["main", "workspace", "panel"],
    availableAudioSources: sourceMode === "live" ? ["none", "measuredSource"] : ["none"],
    accessoryGeometry: {
      dockHeader: {
        visible: docked && !dockSuspended && dockAccessoryVisibility.headerVisible,
        width: window.innerWidth,
        height: 44,
      },
      dockEditor: {
        visible: docked && !dockSuspended && dockAccessoryVisibility.editorVisible,
        width: dockAccessoryVisibility.editorSize.width,
        height: dockAccessoryVisibility.editorSize.height,
      },
    },
  };
  const [hoveredDockPanelId, setHoveredDockPanelId] = useState(null);
  const dockHeaderState = useMemo(
    () => ({
      sourceTransportState,
      clearDisabled: !running && !showClock,
      notice,
      edge: dockEdge,
      reserveSpace,
      editorView: dockAccessoryVisibility.editorView,
      // Configuration metadata is separate from the toolbar's open/closed presentation.
      activeCleanPreset: presets.activeId != null && !presets.dirty,
      loudnessProfileActive: loudnessProfile.active !== LOUDNESS_PROFILE_OFF,
    }),
    [
      dockAccessoryVisibility.editorView,
      dockEdge,
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
      view: dockAccessoryVisibility.editorView,
      panels: dockLayout.panels,
      panelsById: dockLayout.panelsById,
      panelOrder: dockLayout.panelOrder,
      controlsByPanelId: dockLayout.controlsByPanelId,
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
      dockAccessoryVisibility.editorView,
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
          .catch((error) => reportSceneError(error, "Preset failed.", "Preset failed"));
      } else if (type === "save-preset") {
        void presets
          .save(payload.name)
          .catch((error) => reportSceneError(error, "Preset failed.", "Preset failed"));
      } else if (type === "update-preset") {
        void presets
          .update(payload.presetId)
          .catch((error) => reportSceneError(error, "Preset failed.", "Preset failed"));
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
      reportSceneError,
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
    channelRolesRef,
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
    captureApplications,
    onRefreshSources: refreshInventory,
    safeAudioDeviceId,
    setCaptureDeviceId: onSelectCaptureDevice,
    holdFocusControls,
    focusView,
    focusViewActive,
    pinned,
    setPinned,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    surfaceOpacity,
    setSurfaceOpacity,
    glassEnabled,
    setGlassEnabled,
    showDock: isTauri() && supportsDockMode(),
    dockEdge: docked ? dockEdge : null,
    onDockChange,
    dockDisabled: sourceMode === "file",
    presets,
    loudnessProfile,
    loudnessProfileStats,
    onExportLibraryItem: (/** @type {"presets" | "loudness" | "themes"} */ type, id) =>
      packTransfer.exportSelection(type, [id]),
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
    onCopyReport: copyFileAnalysisReportMarkdown,
  };
  const footer = {
    sourceLabel: footerSourceLabel,
    audioDrop: sourceMode === "live" ? meterRuntime.liveAudioDrop : null,
    // The draft outranks the selection, so a profile being edited names the footer too. An
    // unnamed new profile reads Untitled, matching normalizeRuleDocument's fallback.
    loudnessProfileName: loudnessProfile.document
      ? loudnessProfile.document.name || "Untitled"
      : null,
    activePresetName,
    hasUpdate: updateControls.updateInfo?.hasUpdate,
    layoutUnknown: channelCount > 0 && displayAudio?.loudnessLayoutKnown === false,
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
    <>
      <AgentControlBridge {...agentControlBridgeProps} />
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
        recordingState={visualRecordingState}
      >
        <AppSettingsOverlays
          settings={settings}
          crashReportSetting={crashReportSetting}
          crashReporting={crashReporting}
          packTransfer={packTransfer}
          presets={presets}
          loudnessProfile={loudnessProfile}
          channelSettings={{
            channelCount,
            channelLabelTokens,
            channelLabelHasOverride: !!channelLabelOverride,
            selectedLayoutId: channelLabelRuntime.selectedLayoutId,
            setChannelLayout,
            setChannelLabelToken,
            resetChannelLabels,
          }}
          updateControls={updateControls}
          appVersion={APP_VERSION}
          onAgentControlEnabledChange={setAgentControlEnabled}
        />

        <CloseConfirmDialog
          open={closeDialogOpen}
          error={closeError}
          busy={closing}
          onConfirm={handleCloseConfirm}
          onRetry={handleCloseRetry}
          onCancel={handleCloseCancel}
        />
        {DevUiVisualFixture && window.__PLVS_INITIAL_STATE__?.uiVisualFixture ? (
          <Suspense fallback={null}>
            <DevUiVisualFixture name={window.__PLVS_INITIAL_STATE__.uiVisualFixture} />
          </Suspense>
        ) : null}
        <LibraryConflictDialog />
      </AppShell>
    </>
  );
}
