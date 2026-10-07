import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
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
import { BlockingEditorsProvider } from "./hooks/BlockingEditorsContext.jsx";
import { SceneGuardProvider } from "./hooks/SceneGuardContext.jsx";
import { UiNavigationProvider } from "./uiNavigation/UiNavigationContext.jsx";
import { DockProvider, useDock } from "./dock/DockContext.jsx";
import { WindowChromeProvider, useWindowChrome } from "./hooks/WindowChromeContext.jsx";
import { PresetsProvider, usePresetLibrary } from "./hooks/PresetsContext.jsx";
import { SourceProvider, useSource } from "./runtime/SourceContext.jsx";
import { SourceActionsProvider, useSourceActions } from "./runtime/SourceActionsContext.jsx";
import { AppLifecycleProvider, useAppLifecycle } from "./hooks/AppLifecycleContext.jsx";
import { DisplaySnapshotProvider, useDisplaySnapshot } from "./runtime/DisplaySnapshotContext.jsx";
import { AnalysisSessionProvider, useAnalysisSession } from "./runtime/AnalysisSessionContext.jsx";
import { useLoudnessProfileStats } from "./hooks/useLoudnessProfileStats.js";
import { DockAccessoriesProvider, useDockAccessories } from "./dock/DockAccessoriesContext.jsx";
import {
  AgentControlStateProvider,
  useAgentControlState,
} from "./agentControl/AgentControlStateContext.jsx";
import { useSharedTimeViewport } from "./workspace/useSharedTimeViewport.js";
import { formatVectorscopePairLabel } from "./math/vectorscopePairMath.js";
import {} from "./math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { AppShell } from "./components/AppShell.jsx";
import { AppSettingsOverlays } from "./components/AppSettingsOverlays.jsx";
import { usePackTransfer } from "./transfer/usePackTransfer.js";
import { supportsDockMode } from "./lib/platform.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { isTauri } from "./ipc/env.js";
import { resetTruePeakMax } from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { useAppGlobalEffects } from "./hooks/useAppGlobalEffects.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import { LibraryConflictDialog } from "./components/LibraryConflictDialog.jsx";
import packageInfo from "../package.json";
import { AgentControlBridge } from "./agentControl/AgentControlBridge.jsx";

const APP_VERSION = packageInfo.version;
const DevUiVisualFixture = import.meta.env.DEV
  ? lazy(() => import("./dev/UiVisualFixture.jsx"))
  : null;

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
                              {/* Reads MeterRuntime and SourceActions. Its value changes per meter frame. */}
                              <DisplaySnapshotProvider>
                                {/* Reads DisplaySnapshot, Workspace, Dock, Settings and
                                    SourceActions. */}
                                <AnalysisSessionProvider>
                                  {/* Reads Dock, Presets, LoudnessProfile, SourceActions,
                                      DisplaySnapshot and AnalysisSession. */}
                                  <DockAccessoriesProvider>
                                    {/* Reads nothing. Shared by the bridge and the shell. */}
                                    <AgentControlStateProvider>
                                      <AppContent />
                                    </AgentControlStateProvider>
                                  </DockAccessoriesProvider>
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
  const { notice, selectedOffset, setSelectedOffset, showClock } = useMeterDisplayState();
  const { state: workspaceState } = useWorkspaceStore();
  const { visibility: dockAccessoryVisibility, hoveredDockPanelId } = useDockAccessories();
  const { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  useAppGlobalEffects();
  const { sourceMode, running, fileSessions, activeFileSession, activeFileId, analyzingFileId } =
    meterRuntime;
  const {
    fileSession,
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
  const { setSettingsOpen, resolvedThemeId, focusView, surfaceOpacity, glassEnabled } = settings;
  // Hoisted above useDockMode and usePresets: dock entry cancels an open profile
  // draft, and preset capture and apply both need its snapshot helpers. One
  // writer for the reference too - null when Off, which every consumer treats as
  // "there is nothing to show". Reading it this early is safe: it is a context
  // read with no ordering constraints of its own.
  const loudnessProfile = useLoudnessProfile();
  const {
    docked,
    dockEdge,
    dockHeight,
    dockPreviewHeight,
    layout: dockLayout,
    historyViewport: dockHistoryViewport,
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

  const presets = usePresetLibrary();
  const { recordingState: visualRecordingState, setEnabled: setAgentControlEnabled } =
    useAgentControlState();

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
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
    channelCount,
    sourceTransportState,
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
  const showFileAnalysisResult = sourceMode === "file" && fileSessions.length > 0;
  const {
    channelLabelRuntime,
    peakLabelContext,
    setChannelLabelToken,
    setChannelLayout,
    resetChannelLabels,
    vectorscopePairOptions,
    spectrumChannelOptions,
    analysisRequests,
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
  const spectrumValueKey =
    spectrumChannelUi.type === "pair"
      ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
      : `s-${spectrumChannelUi.ch}`;
  const spectrumLiveLabel =
    spectrumChannelOptions.find((o) => o.key === spectrumValueKey)?.label ??
    spectrumChannelOptions[0]?.label ??
    "L/R";
  const vectorscopeChannelLabels = getPeakMeterChannelLabels(
    channelCount >= 2 ? channelCount : 2,
    peakLabelContext
  );
  const vectorscopeLiveLabel = formatVectorscopePairLabel({
    x: vectorscopePairUi.x,
    y: vectorscopePairUi.y,
    channelLabels: vectorscopeChannelLabels,
  });
  const vectorscopeDisplayLabel = channelMetadata?.vectorscopePairLabel ?? vectorscopeLiveLabel;

  const activePreset = presets.list.find((preset) => preset.id === presets.activeId);
  const activePresetName = activePreset ? `${activePreset.name}${presets.dirty ? " *" : ""}` : null;
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
      stereoMapPairOptions: vectorscopePairOptions,
      stereoMapPairDisplayLabel: vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumViewLegend: spectrumViewLegendValue,
    }),
    [
      focusView.compactPanels,
      channelCount,
      vectorscopePairOptions,
      vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumViewLegendValue,
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
      <AgentControlBridge />
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
