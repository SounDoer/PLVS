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
import { HISTORY_MAX_WINDOW_SEC, HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./hooks/useLoudnessHistory.js";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePresets } from "./hooks/usePresets.js";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import {
  buildVectorscopePairOptions,
  formatVectorscopePairLabel,
} from "./math/vectorscopePairMath.js";
import { buildSpectrumChannelOptions } from "./math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeEditor } from "./components/ThemeEditor";
import { FeedbackDialog } from "./components/FeedbackDialog.jsx";
import { AppShell } from "./components/AppShell.jsx";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { deriveClampedPanelControls } from "./workspace/clampPanelControls.js";
import { deriveAnalysisRequests } from "./analysis/analysisRequests.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "./ipc/env.js";
import {
  resetTruePeakMax,
  setAnalysisRequests,
  setLoudnessWeights,
  setDialogueGating,
  setDialogueVadEngine,
} from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { openExternalUrl } from "./ipc/openExternal.js";
import { pickMediaFile } from "./ipc/fileDialog.js";
import { onWindowBoundsChanged } from "./ipc/events.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useApplyUpdate } from "./hooks/useApplyUpdate.js";
import { useFocusViewWindow } from "./hooks/useFocusViewWindow.js";
import { useGlassEffect } from "./hooks/useGlassEffect.js";
import { useConfigurationProfileActions } from "./hooks/useConfigurationProfileActions.js";
import { useCliPathSettings } from "./hooks/useCliPathSettings.js";
import { useFileAnalysisReportExport } from "./hooks/useFileAnalysisReportExport.js";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts.js";
import { useAppGlobalEffects } from "./hooks/useAppGlobalEffects.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import packageInfo from "../package.json";

// Live and file sessions share bounded display history. File-mode summary metrics are authoritative
// for the whole file; panel history is an inspectable downsampled/session view, not unlimited storage.
const HIST_MAX_SAMPLES = 72000;
const VISUAL_MAX_SAMPLES = 180_000; // 25 Hz × 2 h

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

export default function App() {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <AppContent />
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

function AppContent() {
  const {
    state: workspaceState,
    setPanelControls: setWorkspacePanelControls,
    setPanelControlsForPanel,
  } = useWorkspaceStore();
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearanceMode,
    fixedThemeSelectValue,
    setFixedThemeIdFromPicker,
    themeSelectOptions,
    resolvedThemeId,
    closeAction,
    setCloseAction,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
    clearShortcut,
    setClearShortcut,
    clearGlobal,
    setClearGlobal,
    setClearCapturing,
    clearReady,
    registrationError,
    focusView,
    setFocusView,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    channelLabelOverrides,
    setChannelLabelOverrides,
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    createCustomTheme,
    editActiveCustomTheme,
    deleteCustomTheme,
    activeIsCustom,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
  } = useSettings({ onClearRef });
  const { pinned, setPinned, togglePin } = useAlwaysOnTop();
  const suppressPresetDivergenceUntilRef = useRef(Date.now() + 1500);
  const suppressPresetDivergence = useCallback((durationMs = 1500) => {
    suppressPresetDivergenceUntilRef.current = Date.now() + durationMs;
  }, []);
  const {
    configurationBusy,
    configurationStatus,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  } = useConfigurationProfileActions();
  const { cliPathStatus, cliPathBusy, setCliPathEnabled } = useCliPathSettings({ settingsOpen });
  const presets = usePresets({
    windowPinned: pinned,
    setWindowPinned: setPinned,
    focusView,
    setFocusView,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    suppressPresetDivergence,
  });
  useFocusViewWindow(focusView.autoHideControls, focusView.borderless);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let disposed = false;
    let unlisten = null;
    onWindowBoundsChanged(() => {
      if (Date.now() < suppressPresetDivergenceUntilRef.current) return;
      presets.markDirty();
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [presets.markDirty]);

  const {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = useAudioDevices();

  const onHideWindow = useCallback(async () => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    await win.hide();
    await win.setSkipTaskbar(true);
  }, []);

  const onToggleWindow = useCallback(async () => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const visible = await win.isVisible();
    if (visible) {
      await win.hide();
      await win.setSkipTaskbar(true);
    } else {
      await win.show();
      await win.setSkipTaskbar(false);
      await win.setFocus();
    }
  }, []);

  const {
    dialogOpen: closeDialogOpen,
    handleConfirm: handleCloseConfirm,
    handleCancel: handleCloseCancel,
  } = useCloseConfirm({ onHideWindow });

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

  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);
  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  const { display, routing } = useMeterRuntimeAssembly();
  const {
    audio,
    setAudio,
    selectedOffset,
    setSelectedOffset,
    selectedOffsetRef,
    setStatus,
    setStatus2,
    showClock,
  } = display;
  const { clockRef, elapsedMsRef, canClearRef } = display.clock;

  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const normalizedPanelControls = useMemo(() => {
    const firstPanelId = workspaceState.panelOrder.find((id) => workspaceState.panelsById[id]);
    return normalizePanelControls(
      firstPanelId ? getPanelControls(workspaceState, firstPanelId) : undefined
    );
  }, [workspaceState]);
  const referenceLufs = useMemo(() => {
    const loudnessPanelId = workspaceState.panelOrder.find(
      (id) => workspaceState.panelsById[id]?.moduleId === "loudness"
    );
    return normalizePanelControls(
      loudnessPanelId ? getPanelControls(workspaceState, loudnessPanelId) : undefined
    ).loudnessReferenceLufs;
  }, [workspaceState]);
  const derivedAnalysisRequests = useMemo(
    () => deriveAnalysisRequests(workspaceState),
    [workspaceState]
  );
  const analysisRequests = useMemo(
    () => deriveBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  const analysisStatusByPanelId = derivedAnalysisRequests.statusByPanelId;
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumPeakHoldUi = normalizedPanelControls.spectrumPeakHold;
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, install, restartToApply } = useApplyUpdate();
  const [focusControlsVisible, setFocusControlsVisible] = useState(false);
  const [focusControlsHeld, setFocusControlsHeld] = useState(false);
  const focusControlsHideTimerRef = useRef(0);
  const focusControlsDragTimerRef = useRef(0);

  const { intakeRef, fileDisplayIntake, frequencyMarkerRef, getSpectrogramSnapsForKey } = routing;
  const lastSentAnalysisRequestsKeyRef = useRef("");

  // Stable identity: several effects (vectorscope/spectrum clamps, the displayAudio sync)
  // list updatePanelControls in their deps. If its identity changed per dispatch it would
  // re-run those effects → dispatch → re-run → "Maximum update depth exceeded" on Start.
  // Read the latest values through refs and keep useCallback deps empty.
  const panelControlsRef = useRef(normalizedPanelControls);
  panelControlsRef.current = normalizedPanelControls;
  const setWorkspacePanelControlsRef = useRef(setWorkspacePanelControls);
  setWorkspacePanelControlsRef.current = setWorkspacePanelControls;
  const updatePanelControls = useCallback((nextPanelControls) => {
    const current = panelControlsRef.current;
    const next = normalizePanelControls(
      typeof nextPanelControls === "function" ? nextPanelControls(current) : nextPanelControls
    );
    // Skip redundant dispatches: normalize() always returns a new object, so without this
    // an unchanged value would still churn workspace state (and persist) on every frame.
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    setWorkspacePanelControlsRef.current(next);
  }, []);
  const sendTrackedLoudnessWeights = useCallback((weights) => {
    return setLoudnessWeights(weights).catch(() => {});
  }, []);

  const {
    histSourceList,
    displayAudio,
    hasHistoryData,
    correlation,
    channelMetadata,
    visualWaveformSnap,
    targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: intakeRef.current,
    audio,
  });

  const {
    historyWindowSec,
    setHistoryWindowSec,
    historyOffsetSec,
    setHistoryOffsetSec,
    setHistoryHudUntilTs,
    historyHudHold,
    setHistoryHudHold,
    historyChartInteractive,
    totalSamples,
    clampedWindowSec,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
    displayHistoryPathM,
    displayHistoryPathST,
    selectedHistSteps,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    historyTimeTicks,
    targetLufs,
    historyYAxisTicks,
    statsMetrics,
  } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceLufs,
    selectedOffset,
    sourceMode,
  });

  const { fmt, getSamplePeakLineColor, hasTpMaxValue, tpMaxText } = usePeakVis(
    resolvedThemeId,
    displayAudio
  );
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
  // loudness-history window to the whole file and reset scrub so the full analyzed curve shows over
  // an absolute media-time axis. selectedOffset is intentionally not a dependency so user scrubbing
  // afterwards is preserved; getHistoryViewport clamps the window to [MIN, MAX].
  useEffect(() => {
    if (sourceMode !== "file") return;
    if (fileSession.state !== "analyzing" && fileSession.state !== "complete") return;
    setHistoryWindowSec(
      Number.isFinite(fileDurationMs) ? fileDurationMs / 1000 : HISTORY_MAX_WINDOW_SEC
    );
    setHistoryOffsetSec(0);
    setSelectedOffset(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, fileSession.state, fileDurationMs]);

  const latestTimestampMs = useMemo(() => {
    const last = histSourceList.length > 0 ? histSourceList[histSourceList.length - 1] : null;
    return Number.isFinite(last?.timestampMs) ? last.timestampMs : undefined;
  }, [histSourceList]);

  const sourceTransportState = deriveSourceTransportState({
    sourceMode,
    running,
    selectedOffset,
    latestTimestampMs,
    elapsedMs: elapsedMsRef.current,
    selectedMediaTimeMs,
    fileSession,
    analyzingFileSession,
  });
  const showFileAnalysisResult = sourceMode === "file" && fileSessions.length > 0;
  const chromeState = sourceTransportState.chromeState;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;
  const layoutResolution = useMemo(
    () => resolveChannelLayout("auto", { channelCount }),
    [channelCount]
  );
  const channelLabelRuntime = useMemo(
    () => deriveChannelLabelRuntime({ channelCount, layoutResolution, channelLabelOverrides }),
    [channelCount, channelLabelOverrides, layoutResolution]
  );
  const { channelLabelOverride, overrideLabels, loudnessWeights } = channelLabelRuntime;
  const loudnessWeightsRef = useRef(loudnessWeights);
  const { dialogueGating, dialogueVadEngine } = useMemo(
    () => deriveDialogueRuntime(workspaceState),
    [workspaceState]
  );
  const dialogueGatingRef = useRef(dialogueGating);
  const dialogueVadEngineRef = useRef(dialogueVadEngine);
  const channelAutoLabels = channelLabelRuntime.channelAutoLabels;
  const channelLabelTokens = channelLabelRuntime.channelLabelTokens;

  useEffect(() => {
    loudnessWeightsRef.current = loudnessWeights;
    if (!isTauri() || !running) return;
    void sendTrackedLoudnessWeights(loudnessWeights);
  }, [loudnessWeights, running, sendTrackedLoudnessWeights]);

  useEffect(() => {
    const s = document.documentElement.style;
    const p = panelOpacity;
    s.setProperty("--panel-opacity", `${p}%`);
    s.setProperty("--panel-opacity-card", `${Math.round(p * 0.55)}%`);
    s.setProperty("--panel-opacity-header", `${Math.round(p * 0.6)}%`);
    s.setProperty("--panel-opacity-meter", String(Math.max(0.25, p / 100)));
  }, [panelOpacity]);

  useEffect(() => {
    dialogueGatingRef.current = dialogueGating;
    if (!isTauri()) return;
    void setDialogueGating(dialogueGating);
  }, [dialogueGating]);

  useEffect(() => {
    dialogueVadEngineRef.current = dialogueVadEngine;
    if (!isTauri()) return;
    void setDialogueVadEngine(dialogueVadEngine);
  }, [dialogueVadEngine]);

  const currentFileAnalysisSettings = useCallback(
    () => ({
      dialogue: {
        enabled: dialogueGating,
        engine: dialogueGating ? dialogueVadEngine : null,
      },
    }),
    [dialogueGating, dialogueVadEngine]
  );

  useEffect(() => {
    if (!isTauri()) {
      lastSentAnalysisRequestsKeyRef.current = "";
      return;
    }
    // Sync request keys to the backend whenever they change, not only during live capture. The file
    // analysis worker snapshots these at start, so on a fresh launch (no live capture yet) file mode
    // would otherwise get empty requests and the request-keyed panels (Spectrogram/Spectrum/
    // Vectorscope) would stay blank until the first live start.
    const key = JSON.stringify(analysisRequests);
    if (lastSentAnalysisRequestsKeyRef.current === key) return;
    lastSentAnalysisRequestsKeyRef.current = key;
    void setAnalysisRequests(analysisRequests).catch(() => {
      if (lastSentAnalysisRequestsKeyRef.current === key) {
        lastSentAnalysisRequestsKeyRef.current = "";
      }
    });
  }, [analysisRequests]);

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
    [channelCount, channelAutoLabels]
  );

  const resetChannelLabels = useCallback(() => {
    setChannelLabelOverrides((prev) => {
      if (!(channelCount in prev)) return prev;
      const next = { ...prev };
      delete next[channelCount];
      return next;
    });
  }, [channelCount]);

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

  const showFocusControls = useCallback(() => {
    window.clearTimeout(focusControlsHideTimerRef.current);
    setFocusControlsVisible(true);
  }, []);

  const hideFocusControlsLater = useCallback(() => {
    if (focusControlsHeld) return;
    window.clearTimeout(focusControlsHideTimerRef.current);
    focusControlsHideTimerRef.current = window.setTimeout(() => {
      setFocusControlsVisible(false);
    }, 900);
  }, [focusControlsHeld]);

  const hideFocusControlsNow = useCallback(() => {
    if (focusControlsHeld) return;
    window.clearTimeout(focusControlsHideTimerRef.current);
    setFocusControlsVisible(false);
  }, [focusControlsHeld]);

  const toggleFocusControls = useCallback(() => {
    if (focusControlsVisible) {
      hideFocusControlsNow();
    } else {
      showFocusControls();
      focusControlsHideTimerRef.current = window.setTimeout(() => {
        setFocusControlsVisible(false);
      }, 3000);
    }
  }, [focusControlsVisible, hideFocusControlsNow, showFocusControls]);

  const holdFocusControls = useCallback((open) => {
    setFocusControlsHeld(open);
    if (open) {
      window.clearTimeout(focusControlsHideTimerRef.current);
      setFocusControlsVisible(true);
    }
  }, []);

  const releaseFocusControlsHold = useCallback(() => {
    setFocusControlsHeld(false);
  }, []);

  const frameless = focusView.autoHideControls || focusView.borderless;

  const handleWindowDrag = useCallback(
    async (event) => {
      if (!frameless || event.button !== 0 || event.target !== event.currentTarget) return;
      if (!isTauri()) return;
      const releaseAfterDrag = () => {
        releaseFocusControlsHold();
        window.clearTimeout(focusControlsDragTimerRef.current);
      };
      try {
        holdFocusControls(true);
        window.addEventListener("pointerup", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("pointercancel", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("mouseup", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("blur", releaseAfterDrag, { once: true });
        focusControlsDragTimerRef.current = window.setTimeout(releaseAfterDrag, 10000);
        const win = getCurrentWindow();
        if (typeof win.startDragging === "function") await win.startDragging();
      } catch (_) {
        releaseAfterDrag();
      }
    },
    [frameless, holdFocusControls, releaseFocusControlsHold]
  );

  useEffect(() => {
    if (!focusView.autoHideControls) {
      setFocusControlsVisible(false);
      setFocusControlsHeld(false);
    }
  }, [focusView.autoHideControls]);

  useEffect(
    () => () => {
      window.clearTimeout(focusControlsHideTimerRef.current);
      window.clearTimeout(focusControlsDragTimerRef.current);
    },
    []
  );

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

  const onVectorscopePairChange = (pair) => {
    const nextVectorscopeLabel = formatVectorscopePairLabel({
      x: pair.x,
      y: pair.y,
      channelLabels: vectorscopeChannelLabels,
    });
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: nextVectorscopeLabel,
    });
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, vectorscopePair: pair }));
  };

  const onSpectrumChannelChange = (sel) => {
    const prevLabel = spectrumLiveLabel;
    const nextKey = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
    const nextLabel = spectrumChannelOptions.find((o) => o.key === nextKey)?.label ?? prevLabel;
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: nextLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumChannel: sel }));
    if (running && prevLabel !== nextLabel) {
      intakeRef.current.setPendingFrequencyMarker({ from: prevLabel, to: nextLabel });
    }
  };

  const onSpectrumViewChange = (view) => {
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumView: view }));
  };

  const onSpectrumPeakHoldToggle = () => {
    updatePanelControls((current) => ({ ...current, spectrumPeakHold: !spectrumPeakHoldUi }));
  };

  const {
    showHistoryHud,
    holdHistoryHud,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    isTimeAxisActive,
    historyTimeAxisHandlers,
  } = useHistoryInteraction({
    enabled: historyChartInteractive,
    sampleSec: HIST_SAMPLE_SEC,
    minWindowSec: HISTORY_MIN_WINDOW_SEC,
    maxWindowSec: HISTORY_MAX_WINDOW_SEC,
    defaultWindowSec: UI_PREFERENCES.modules.loudness.history.defaultWindowSec,
    totalSamples,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
    setSelectedOffset,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    setHistoryHudUntilTs,
    setHistoryHudHold,
  });

  const captureCurrentSnapshot = useCallback(() => {
    if (!historyChartInteractive || totalSamples <= 0) return;
    setSelectedOffset(0);
    showHistoryHud(1600);
  }, [historyChartInteractive, totalSamples, setSelectedOffset, showHistoryHud]);

  const clearAll = async () => {
    const cleared = await clearActiveSource();
    if (cleared) {
      setHistoryOffsetSec(0);
      setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    }
  };
  onClearRef.current = clearAll;

  const resetTpMax = async () => {
    if (isTauri()) {
      try {
        await resetTruePeakMax();
      } catch (_) {}
    }
    setAudio((prev) => ({ ...prev, tpMax: -Infinity }));
  };

  const beginFileAnalysis = useCallback(
    (path) => {
      beginRuntimeFileAnalysis(path, currentFileAnalysisSettings());
    },
    [beginRuntimeFileAnalysis, currentFileAnalysisSettings]
  );

  const reanalyzeActiveFile = useCallback(
    (entry) => {
      reanalyzeFile(entry?.id, currentFileAnalysisSettings());
    },
    [currentFileAnalysisSettings, reanalyzeFile]
  );

  const { exportFileAnalysisReport } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    setStatus,
  });

  const onSelectFile = (id) => {
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    selectFile(id);
  };

  const onStopFile = (id) => {
    void stopFileAnalysis(id);
  };

  const onReanalyzeFile = (id) => {
    reanalyzeFile(id, currentFileAnalysisSettings());
  };

  const onRemoveFile = async (id) => {
    const clearedDisplay = await removeFile(id);
    if (clearedDisplay) {
      setHistoryOffsetSec(0);
      setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    }
  };

  const onClearAllFiles = async () => {
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    await clearFiles();
  };

  // `path` already comes from the Tauri drag-drop event (a real filesystem path).
  const handleDropFile = useCallback((path) => beginFileAnalysis(path), [beginFileAnalysis]);

  const runLiveStartAction = () => {
    if (selectedOffset >= 0) {
      setSelectedOffset(-1);
      setStatus("Monitoring live input");
      return;
    }
    if (running) {
      stopLive();
      return;
    }
    startLive();
  };

  const onSourceTransportAction = async (actionKind) => {
    if (actionKind === "returnToLive") {
      setSelectedOffset(-1);
      setStatus("Monitoring live input");
      return;
    }
    if (actionKind === "startLive" || actionKind === "stopLive") {
      runLiveStartAction();
      return;
    }
    if (actionKind === "returnToFileResult") {
      setSelectedOffset(-1);
      setStatus("File analysis result");
      return;
    }
    if (actionKind === "chooseFile") {
      const path = await pickMediaFile();
      if (path) beginFileAnalysis(path);
      return;
    }
    if (actionKind === "analyzeFile") {
      if (activeFileSession?.path) {
        reanalyzeActiveFile(activeFileSession);
      } else {
        const path = await pickMediaFile();
        if (path) beginFileAnalysis(path);
      }
      return;
    }
    if (actionKind === "reanalyzeFile") {
      reanalyzeActiveFile(activeFileSession);
      return;
    }
    if (actionKind === "stopFileAnalysis") {
      void stopFileAnalysis();
      return;
    }
  };

  const onStartClick = runLiveStartAction;

  const onSourceModeChange = (nextMode) => {
    if (nextMode === sourceMode) return;
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    switchSource(nextMode);
  };

  useTray({
    running,
    pinned,
    togglePin,
    onStartClick,
    deviceName,
    onToggleWindow,
    colorScheme: resolvedTheme.colorScheme,
  });

  useAppKeyboardShortcuts({
    clearAll,
    running,
    showClock,
    setSettingsOpen,
    clearShortcut,
    autoHideControls: focusView.autoHideControls,
    toggleFocusControls,
  });

  /** Matches Loudness History snapshot mode: meters/spectrum/vector read the selected instant, not live input */
  useEffect(() => {
    if (!running || selectedOffset < 0) return;
    setStatus("History snapshot (not live input)");
  }, [running, selectedOffset]);

  useEffect(() => {
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
  }, [spectrumLiveLabel, vectorscopeLiveLabel]);

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
      spectrumChannelOptions,
      spectrumValueKey,
      spectrumDisplayLabel,
      spectrumView: spectrumViewUi,
      spectrumViewLegend: spectrumViewLegendValue,
      spectrumPeakHold: spectrumPeakHoldUi,
      analysisStatusByPanelId,
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
      spectrumPeakHoldUi,
      analysisStatusByPanelId,
    ]
  );

  const audioData = {
    // Peak
    displayAudio,
    getSamplePeakLineColor,
    fmt,
    hasTpMaxValue,
    tpMaxText,
    onResetTpMax: resetTpMax,
    // Vectorscope
    vsGridDiagInset,
    vsGridDiagFar,
    correlation,
    vectorscopePairOptions,
    vectorscopeValueKey,
    vectorscopeDisplayLabel,
    onVectorscopePairChange,
    vectorscopePairX: vectorscopePairUi.x,
    vectorscopePairY: vectorscopePairUi.y,
    panelControls: normalizedPanelControls,
    onPanelControlsChange: updatePanelControls,
    // Shared
    selectedOffset,
    setSelectedOffset,
    channelCount,
    peakLabelContext,
    running,
    setStatus,
    resolvedThemeId,
    // Loudness history
    historyYAxisTicks,
    targetLufs,
    referenceLufs,
    hasHistoryData,
    historyChartInteractive,
    displayHistoryPathM,
    displayHistoryPathST,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    clampedWindowSec,
    effectiveOffsetSec,
    historyTimeTicks,
    statsMetrics,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    historyTimeAxisHandlers,
    historyTimeAxisActive: isTimeAxisActive,
    captureCurrentSnapshot,
    // Spectrum
    spectrumChannelOptions,
    spectrumValueKey,
    spectrumDisplayLabel,
    onSpectrumChannelChange,
    spectrumView: spectrumViewUi,
    onSpectrumViewChange,
    spectrumViewLegend: spectrumViewLegendValue,
    spectrumPeakHold: spectrumPeakHoldUi,
    onSpectrumPeakHoldToggle,
    // Spectrogram
    frequencyMarkerRef,
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
    histSourceList,
    visualWaveformSnap,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    getSpectrogramSnapsForKey,
    analysisStatusByPanelId,
    dialogueActiveNow: displayAudio?.dialogueActiveNow ?? false,
    compactPanels: focusView.compactPanels,
  };
  const runtimeEnginesProps = {
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples: HIST_MAX_SAMPLES,
    visualMaxSamples: VISUAL_MAX_SAMPLES,
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
    sourceMode,
    onSourceModeChange,
    onSourceTransportAction,
    onClear: clearAll,
    clearDisabled: sourceMode === "file" ? !activeFileSession : !running && !showClock,
    isTauriApp: isTauri(),
    onOpenFile: async () => {
      const path = await pickMediaFile();
      if (path) beginFileAnalysis(path);
    },
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
    presets,
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
    referenceLufs,
    activePresetName,
    hasUpdate: updateInfo?.hasUpdate,
    onOpenSettings: () => setSettingsOpen(true),
  };

  return (
    <AppShell
      audioData={audioData}
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
      <SettingsPanel
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        appearance={appearance}
        setAppearanceMode={setAppearanceMode}
        fixedThemeSelectValue={fixedThemeSelectValue}
        setFixedThemeIdFromPicker={setFixedThemeIdFromPicker}
        themeSelectOptions={themeSelectOptions}
        channelCount={channelCount}
        channelLabelTokens={channelLabelTokens}
        channelLabelHasOverride={!!channelLabelOverride}
        setChannelLabelToken={setChannelLabelToken}
        resetChannelLabels={resetChannelLabels}
        appVersion={APP_VERSION}
        latestVersion={updateInfo?.latestVersion}
        releaseUrl={updateInfo?.releaseUrl}
        hasUpdate={updateInfo?.hasUpdate}
        updateStatus={updateInfo?.status}
        onCheckForUpdate={refreshUpdateCheck}
        installStatus={installStatus}
        onInstallUpdate={() => install(updateInfo?.update)}
        onRestartToApply={restartToApply}
        openExternalUrl={openExternalUrl}
        autostartEnabled={autostartEnabled}
        setAutostartEnabled={setAutostartEnabled}
        autostartReady={autostartReady}
        closeAction={closeAction}
        setCloseAction={setCloseAction}
        clearShortcut={clearShortcut}
        setClearShortcut={setClearShortcut}
        clearGlobal={clearGlobal}
        setClearGlobal={setClearGlobal}
        setClearCapturing={setClearCapturing}
        clearReady={clearReady}
        registrationError={registrationError}
        customThemeOptions={customThemeOptions}
        createCustomTheme={createCustomTheme}
        editActiveCustomTheme={editActiveCustomTheme}
        deleteCustomTheme={deleteCustomTheme}
        activeIsCustom={activeIsCustom}
        themeControlsDisabled={editor.isEditing}
        onExportConfiguration={exportConfiguration}
        onImportConfiguration={importConfiguration}
        onResetConfiguration={resetConfiguration}
        configurationBusy={configurationBusy}
        configurationStatus={configurationStatus}
        cliPathStatus={cliPathStatus}
        cliPathBusy={cliPathBusy}
        onSetCliPathEnabled={setCliPathEnabled}
        onOpenFeedback={() => {
          setSettingsOpen(false);
          setFeedbackOpen(true);
        }}
      />

      {feedbackOpen ? <FeedbackDialog onClose={() => setFeedbackOpen(false)} /> : null}

      {editor.isEditing ? (
        <ThemeEditor
          draft={editor.draft}
          onName={editor.setName}
          onSeed={editor.updateSeed}
          onShell={editor.updateShell}
          onSave={editor.save}
          onCancel={editor.cancel}
          onDelete={undefined}
          dirty={editor.dirty}
          pos={editorPos}
          onMove={moveEditor}
        />
      ) : null}

      <CloseConfirmDialog
        open={closeDialogOpen}
        onConfirm={handleCloseConfirm}
        onCancel={handleCloseCancel}
      />
    </AppShell>
  );
}
