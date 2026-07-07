import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import { AudioDataContext } from "./workspace/AudioDataContext.jsx";
import { FrameIntake } from "./lib/FrameIntake.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { cleanupLegacyKeys } from "./persistence/cleanupLegacyKeys.js";
import { normalizePanelControls } from "./lib/panelControls.js";
import { HISTORY_MAX_WINDOW_SEC, HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./hooks/useLoudnessHistory.js";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useFileAnalysisEngine } from "./hooks/useFileAnalysisEngine.js";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePresets } from "./hooks/usePresets.js";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { useSessionTimer } from "./hooks/useSessionTimer.js";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import {
  buildVectorscopePairOptions,
  formatVectorscopePairLabel,
} from "./math/vectorscopePairMath.js";
import { buildSpectrumChannelOptions } from "./math/spectrumChannelOptions.js";
import {
  roleTokensToLabels,
  roleTokensToLoudnessWeights,
  seedTokensFromLabels,
} from "./math/channelRoles.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeEditor } from "./components/ThemeEditor";
import { FeedbackDialog } from "./components/FeedbackDialog.jsx";
import { AppHeader } from "./components/AppHeader.jsx";
import { FileAnalysisSummary } from "./components/FileAnalysisSummary.jsx";
import { FileDropOverlay } from "./components/FileDropOverlay.jsx";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
import {
  addFileEntry,
  clearFileHistory,
  createInitialFileHistory,
  getActiveFileSession,
  getAnalyzingFileSession,
  removeFileEntry,
  selectFileEntry,
  startFileAnalysisEntry,
  updateFileEntry,
} from "./lib/fileAnalysisSessionRegistry.js";
import { SplitLayout } from "./workspace/SplitLayout.jsx";
import { preventNativeContextMenu } from "./lib/contextMenu.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { deriveClampedPanelControls } from "./workspace/clampPanelControls.js";
import { deriveAnalysisRequests } from "./analysis/analysisRequests.js";
import { eventMatchesAccelerator } from "./lib/accelerator.js";
import {
  FOOTER_DIVIDER,
  FOOTER_LABEL,
  FOOTER_VALUE,
  SHELL_BOTTOM_REVEAL_HOT_ZONE,
  SHELL_FOOTER,
  SHELL_FOOTER_OVERLAY,
  SHELL_INNER,
  SHELL_INNER_FOCUS,
  SHELL_PAGE,
  SHELL_TOP_REVEAL_HOT_ZONE,
} from "@/lib/shellLayout";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "./ipc/env.js";
import {
  clearAudioHistory,
  cliPathStatusCommand,
  readProfileFile,
  resetTruePeakMax,
  setAnalysisRequests,
  setCliPathEnabledCommand,
  setLoudnessWeights,
  setDialogueGating,
  setDialogueVadEngine,
  writeProfileFile,
  writeTextFile,
} from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE } from "./lib/dialogueVadEngines.js";
import { openExternalUrl } from "./ipc/openExternal.js";
import {
  pickConfigurationProfileFile,
  pickMediaFile,
  saveConfigurationProfileFile,
  saveFileAnalysisReportFile,
} from "./ipc/fileDialog.js";
import {
  exportProfile,
  importProfile,
  reloadAfterProfileChange,
  resetProfile,
} from "./persistence/profile.js";
import { onWindowBoundsChanged } from "./ipc/events.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useApplyUpdate } from "./hooks/useApplyUpdate.js";
import { useFocusViewWindow } from "./hooks/useFocusViewWindow.js";
import { useGlassEffect } from "./hooks/useGlassEffect.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import {
  buildFileAnalysisReport,
  defaultFileAnalysisReportName,
  stringifyFileAnalysisReport,
} from "./lib/fileAnalysisReport.js";
import packageInfo from "../package.json";

// Live and file sessions share bounded display history. File-mode summary metrics are authoritative
// for the whole file; panel history is an inspectable downsampled/session view, not unlimited storage.
const HIST_MAX_SAMPLES = 72000;
const VISUAL_MAX_SAMPLES = 180_000; // 25 Hz × 2 h
const DIALOGUE_STAT_IDS = [
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
];

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

function toBackendAnalysisRequests(requests) {
  return {
    spectrum: requests.spectrumRequests.map((request) => ({
      key: request.key,
      channel: request.channel,
      view: request.view,
      smoothingPercent: request.smoothingPercent,
      tiltDbPerOctave: request.tiltDbPerOctave,
    })),
    vectorscope: requests.vectorscopeRequests.map((request) => ({
      key: request.key,
      x: request.pair.x,
      y: request.pair.y,
    })),
  };
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppContent />
    </WorkspaceProvider>
  );
}

function AppContent() {
  const {
    state: workspaceState,
    setPanelControls: setWorkspacePanelControls,
    setPanelControlsForPanel,
  } = useWorkspaceStore();
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
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [configurationStatus, setConfigurationStatus] = useState("");
  const [cliPathStatus, setCliPathStatus] = useState(undefined);
  const [cliPathBusy, setCliPathBusy] = useState(false);
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

  const exportConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      const profile = await exportProfile();
      const contents = `${JSON.stringify(profile, null, 2)}\n`;
      if (isTauri()) {
        const path = await saveConfigurationProfileFile("plvs-configuration.plvsconfig");
        if (!path) {
          setConfigurationStatus("");
          return;
        }
        await writeProfileFile(path, contents);
      } else {
        const blob = new Blob([contents], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "plvs-configuration.plvsconfig";
        a.click();
        URL.revokeObjectURL(url);
      }
      setConfigurationStatus("Configuration exported");
    } catch (_) {
      setConfigurationStatus("Export failed");
    } finally {
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  const importConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      if (!isTauri()) {
        setConfigurationStatus("Import is available in the desktop app");
        return;
      }
      const path = await pickConfigurationProfileFile();
      if (!path) {
        setConfigurationStatus("");
        return;
      }
      const raw = await readProfileFile(path);
      await importProfile(JSON.parse(raw));
      reloadAfterProfileChange();
    } catch (_) {
      setConfigurationStatus("Import failed");
    } finally {
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  const resetConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      await resetProfile();
      reloadAfterProfileChange();
    } catch (_) {
      setConfigurationStatus("Reset failed");
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  useEffect(() => {
    if (!settingsOpen || !isTauri()) return;
    let disposed = false;
    setCliPathStatus(null);
    cliPathStatusCommand()
      .then((nextStatus) => {
        if (!disposed) setCliPathStatus(nextStatus);
      })
      .catch(() => {
        if (!disposed) {
          setCliPathStatus({
            supported: false,
            installed: false,
            onPath: false,
            message: "Command line tools are unavailable.",
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [settingsOpen]);

  const setCliPathEnabled = useCallback(async (enabled) => {
    if (!isTauri()) return;
    setCliPathBusy(true);
    try {
      const nextStatus = await setCliPathEnabledCommand(enabled);
      setCliPathStatus(nextStatus);
    } catch (_) {
      setCliPathStatus((current) => ({
        ...(current ?? {}),
        supported: current?.supported ?? true,
        installed: current?.installed ?? false,
        onPath: current?.onPath ?? false,
        message: "PATH update failed.",
      }));
    } finally {
      setCliPathBusy(false);
    }
  }, []);

  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);
  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  const { clockRef, elapsedMsRef, canClearRef, startTimer, stopTimer, resetTimer } =
    useSessionTimer();
  const [showClock, setShowClock] = useState(false);

  const [sourceMode, setSourceMode] = useState("live");
  const [fileHistory, setFileHistory] = useState(() => createInitialFileHistory());
  const [fileRunRequest, setFileRunRequest] = useState(null);
  const fileEntrySeqRef = useRef(0);
  const fileSessions = useMemo(
    () => fileHistory.order.map((id) => fileHistory.sessionsById[id]).filter(Boolean),
    [fileHistory]
  );
  const activeFileSession = useMemo(() => getActiveFileSession(fileHistory), [fileHistory]);
  const analyzingFileSession = useMemo(() => getAnalyzingFileSession(fileHistory), [fileHistory]);
  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const [running, setRunning] = useState(false);
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [status, setStatus] = useState("Ready - click Start to begin monitoring");
  const [status2, setStatus2] = useState("Device: Not connected");
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
    () => toBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  const analysisStatusByPanelId = derivedAnalysisRequests.statusByPanelId;
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumPeakHoldUi = normalizedPanelControls.spectrumPeakHold;
  const [audio, setAudio] = useState({
    peakDb: [],
    rmsDb: [],
    peakHoldDb: [],
    momentary: -Infinity,
    shortTerm: -Infinity,
    integrated: -Infinity,
    mMax: -Infinity,
    stMax: -Infinity,
    lra: -Infinity,
    tpL: -Infinity,
    tpR: -Infinity,
    truePeakL: -Infinity,
    truePeakR: -Infinity,
    tpMax: -Infinity,
    samplePeakMaxL: -Infinity,
    samplePeakMaxR: -Infinity,
    sampleL: -Infinity,
    sampleR: -Infinity,
    samplePeak: -Infinity,
    correlation: -Infinity,
    sideToMidDb: -Infinity,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    spectrumResultsByKey: {},
    vectorscopeResultsByKey: {},
  });
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, install, restartToApply } = useApplyUpdate();
  const [focusControlsVisible, setFocusControlsVisible] = useState(false);
  const [focusControlsHeld, setFocusControlsHeld] = useState(false);
  const focusControlsHideTimerRef = useRef(0);
  const focusControlsDragTimerRef = useRef(0);

  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  // Live and File keep separate history rings so a source switch never bleeds one into the other,
  // and returning to File restores its previous analysis without re-decoding. Each engine writes its
  // own ring (live->liveIntake, file->fileIntake); `intakeRef` always points at the active source's
  // ring and is what the display / channel-metadata reads use.
  const liveIntakeRef = useRef(null);
  if (liveIntakeRef.current === null) liveIntakeRef.current = new FrameIntake();
  const emptyFileIntakeRef = useRef(null);
  if (emptyFileIntakeRef.current === null) emptyFileIntakeRef.current = new FrameIntake();
  const fileDisplayIntake = activeFileSession?.intake ?? emptyFileIntakeRef.current;
  const fileAnalysisIntake = analyzingFileSession?.intake ?? emptyFileIntakeRef.current;
  // The file frame pump drives the shared live `audio` display only while the analyzing session is
  // the one being shown. Switching to another file freezes that session's panels (its intake still
  // fills in the background) instead of letting the in-progress analysis hijack the meters.
  const fileDisplayActiveRef = useRef(false);
  fileDisplayActiveRef.current =
    sourceMode === "file" &&
    fileHistory.analyzingFileId != null &&
    fileHistory.analyzingFileId === fileHistory.activeFileId;
  const intakeRef = useRef(liveIntakeRef.current);
  intakeRef.current = sourceMode === "file" ? fileDisplayIntake : liveIntakeRef.current;
  const frequencyMarkerRef = useMemo(
    () => ({
      get current() {
        return intakeRef.current.getFrequencyChannelMarkers();
      },
    }),
    []
  );
  // Live per-request-key spectrogram source: each Spectrogram panel reads the rolling history for
  // its own request key so two spectrograms with different channel/view never share one history.
  const getSpectrogramSnapsForKey = useCallback(
    (key) => intakeRef.current.getSpectrogramSnapsForKey(key),
    []
  );
  const selectedOffsetRef = useRef(-1);
  const defaultSampleRateRef = useRef(48000);
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
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = useMemo(
    () => (channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null),
    [channelLabelOverride]
  );
  const loudnessWeights = useMemo(
    () => (channelLabelOverride ? roleTokensToLoudnessWeights(channelLabelOverride) : null),
    [channelLabelOverride]
  );
  const loudnessWeightsRef = useRef(loudnessWeights);
  const dialogueGating = useMemo(
    () =>
      workspaceState.panelOrder.some((panelId) => {
        const panel = workspaceState.panelsById[panelId];
        if (panel?.moduleId !== "stats") return false;
        const controls = getPanelControls(workspaceState, panelId);
        return controls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id));
      }),
    [workspaceState]
  );
  const dialogueVadEngine = useMemo(() => {
    for (const panelId of workspaceState.panelOrder) {
      const panel = workspaceState.panelsById[panelId];
      if (panel?.moduleId !== "stats") continue;
      const controls = getPanelControls(workspaceState, panelId);
      if (controls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id))) {
        return controls.dialogueVadEngine ?? DEFAULT_DIALOGUE_VAD_ENGINE;
      }
    }
    return DEFAULT_DIALOGUE_VAD_ENGINE;
  }, [workspaceState]);
  const dialogueGatingRef = useRef(dialogueGating);
  const dialogueVadEngineRef = useRef(dialogueVadEngine);
  const channelAutoLabels = useMemo(
    () =>
      channelCount > 0
        ? getPeakMeterChannelLabels(channelCount, {
            channelLayout: "auto",
            resolvedLayout: layoutResolution.resolved,
          })
        : [],
    [channelCount, layoutResolution.resolved]
  );
  const channelLabelTokens = useMemo(
    () => channelLabelOverride ?? seedTokensFromLabels(channelAutoLabels),
    [channelLabelOverride, channelAutoLabels]
  );

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

  const peakLabelContext = useMemo(
    () => ({
      channelLayout: "auto",
      // Idle (no signal yet): treat the default 2ch as stereo so every panel shows L/R
      // instead of numbered Ch labels. Once a real layout resolves this falls through.
      resolvedLayout: channelCount === 0 ? "stereo" : layoutResolution.resolved,
      overrideLabels,
    }),
    [channelCount, layoutResolution.resolved, overrideLabels]
  );

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

  // Clear the live-driven meter display only: spectrum/vector paths, the displayed audio snapshot,
  // and the scrub window. Does NOT touch any history ring, so it is safe to call when switching to
  // File (whose ring must be preserved to restore the previous analysis).
  const clearMeterDisplayState = () => {
    setAudio({
      peakDb: [],
      rmsDb: [],
      peakHoldDb: [],
      momentary: -Infinity,
      shortTerm: -Infinity,
      integrated: -Infinity,
      mMax: -Infinity,
      stMax: -Infinity,
      lra: -Infinity,
      tpL: -Infinity,
      tpR: -Infinity,
      truePeakL: -Infinity,
      truePeakR: -Infinity,
      tpMax: -Infinity,
      samplePeakMaxL: -Infinity,
      samplePeakMaxR: -Infinity,
      sampleL: -Infinity,
      sampleR: -Infinity,
      samplePeak: -Infinity,
      correlation: -Infinity,
    });
    setSelectedOffset(-1);
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
  };

  // Reset the active source's history ring AND clear the display. Used by Clear, which wipes whatever
  // source is currently shown.
  const resetMeterView = () => {
    intakeRef.current.reset();
    clearMeterDisplayState();
  };

  const updateFileSession = useCallback((sessionId, updater) => {
    setFileHistory((history) => updateFileEntry(history, sessionId, updater));
  }, []);

  const setAnalyzingFileId = useCallback((nextOrUpdater) => {
    setFileHistory((history) => {
      const nextId =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(history.analyzingFileId)
          : nextOrUpdater;
      const analyzingFileId = nextId && history.sessionsById[nextId] ? nextId : null;
      if (analyzingFileId === history.analyzingFileId) return history;
      return { ...history, analyzingFileId };
    });
  }, []);

  const validFileRunRequest =
    fileRunRequest &&
    fileRunRequest.sessionId === fileHistory.analyzingFileId &&
    fileHistory.sessionsById[fileRunRequest.sessionId]
      ? fileRunRequest
      : null;

  const fileAnalysis = useFileAnalysisEngine({
    enabled: sourceMode === "file" && Boolean(validFileRunRequest),
    sessionId: validFileRunRequest?.sessionId ?? null,
    filePath: validFileRunRequest?.filePath ?? "",
    runId: validFileRunRequest?.runId ?? 0,
    histMaxSamples: HIST_MAX_SAMPLES,
    visualMaxSamples: VISUAL_MAX_SAMPLES,
    audioRef,
    frameRef,
    selectedOffsetRef,
    defaultSampleRateRef,
    intake: fileAnalysisIntake,
    updateFileSession,
    setAnalyzingFileId,
    setAudio,
    setHistoryPathM: () => {},
    setHistoryPathST: () => {},
    setSelectedOffset,
    setStatus,
    shouldDriveDisplay: () => fileDisplayActiveRef.current,
  });

  const stopCurrentFileAnalysis = useCallback(async () => {
    const sessionId = fileHistory.analyzingFileId;
    if (!sessionId) return;

    try {
      await fileAnalysis.stop();
    } finally {
      setFileRunRequest(null);
      setFileHistory((history) => {
        if (history.analyzingFileId !== sessionId) return history;
        const updatedHistory = updateFileEntry(history, sessionId, (entry) => ({
          ...entry,
          state: "ready",
          progress: 0,
          error: null,
        }));
        return { ...updatedHistory, analyzingFileId: null };
      });
      setStatus("File analysis stopped");
    }
  }, [fileAnalysis, fileHistory.analyzingFileId]);

  const clearAll = async () => {
    if (sourceMode === "file") {
      const activeId = fileHistory.activeFileId;
      if (!activeId) return;
      const activeEntry = fileHistory.sessionsById[activeId];
      if (fileHistory.analyzingFileId === activeId) {
        await stopCurrentFileAnalysis();
      }
      activeEntry?.intake?.reset?.();
      clearMeterDisplayState();
      setFileHistory((history) => removeFileEntry(history, activeId));
      setStatus(
        fileHistory.order.length > 1
          ? "File entry cleared"
          : "File mode - drop a file or click Analyze"
      );
      resetTimer({ restart: false });
      setShowClock(false);
      return;
    }

    if (audioRef.current?.wklt) {
      try {
        audioRef.current.wklt.port.postMessage("reset");
      } catch (_) {}
    }
    if (isTauri()) {
      try {
        await clearAudioHistory();
      } catch (_) {}
    }
    resetMeterView();
    setStatus(
      running
        ? "Running - cleared history and peak hold"
        : "Ready - click Start to begin monitoring"
    );
    resetTimer({ restart: running });
    setShowClock(running);
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
      if (!path) return;
      if (fileHistory.analyzingFileId) {
        setStatus("File analysis already in progress");
        return;
      }

      const runId = fileEntrySeqRef.current + 1;
      fileEntrySeqRef.current = runId;
      const sessionId = `file-analysis-${Date.now()}-${runId}`;
      const intake = new FrameIntake();
      const analysisSettings = currentFileAnalysisSettings();

      setSelectedOffset(-1);
      selectedOffsetRef.current = -1;
      setFileHistory((history) =>
        startFileAnalysisEntry(
          addFileEntry(history, {
            id: sessionId,
            path,
            intake,
            analysisSettings,
          }),
          sessionId,
          { analysisSettings }
        )
      );
      setFileRunRequest({ sessionId, filePath: path, runId });
    },
    [currentFileAnalysisSettings, fileHistory.analyzingFileId, setSelectedOffset]
  );

  const reanalyzeActiveFile = useCallback(
    (entry) => {
      if (!entry?.id || !entry.path) {
        setStatus("Choose a file to analyze");
        return;
      }
      if (fileHistory.analyzingFileId) {
        setStatus("File analysis already in progress");
        return;
      }

      const runId = fileEntrySeqRef.current + 1;
      fileEntrySeqRef.current = runId;
      const analysisSettings = currentFileAnalysisSettings();
      setSelectedOffset(-1);
      selectedOffsetRef.current = -1;
      setFileHistory((history) => startFileAnalysisEntry(history, entry.id, { analysisSettings }));
      setFileRunRequest({ sessionId: entry.id, filePath: entry.path, runId });
    },
    [currentFileAnalysisSettings, fileHistory.analyzingFileId, setSelectedOffset]
  );

  const exportFileAnalysisReport = useCallback(async () => {
    if (fileSession.state !== "complete") {
      setStatus("Choose a completed file analysis to export");
      return;
    }

    try {
      const report = buildFileAnalysisReport(fileSession, { appVersion: APP_VERSION });
      const contents = stringifyFileAnalysisReport(report);
      const defaultName = defaultFileAnalysisReportName(fileSession);

      if (isTauri()) {
        const path = await saveFileAnalysisReportFile(defaultName);
        if (!path) return;
        await writeTextFile(path, contents);
      } else {
        const blob = new Blob([contents], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus("File analysis report exported");
    } catch (_) {
      setStatus("Report export failed");
    }
  }, [fileSession]);

  const onSelectFile = (id) => {
    setSelectedOffset(-1);
    selectedOffsetRef.current = -1;
    clearMeterDisplayState();
    setFileHistory((history) => selectFileEntry(history, id));
    setStatus("File analysis result");
  };

  const onStopFile = (id) => {
    // Only one file analyzes at a time; ignore a stale id that no longer matches.
    if (id && id !== fileHistory.analyzingFileId) return;
    void stopCurrentFileAnalysis();
  };

  const onReanalyzeFile = (id) => {
    const entry = fileHistory.sessionsById[id];
    reanalyzeActiveFile(entry);
  };

  const onRemoveFile = async (id) => {
    const entry = fileHistory.sessionsById[id];
    if (!entry) return;
    const removedAnalyzingFile = fileHistory.analyzingFileId === id;

    if (removedAnalyzingFile) {
      await stopCurrentFileAnalysis();
    }
    entry.intake?.reset?.();
    if (fileHistory.activeFileId === id || fileHistory.order.length <= 1) {
      clearMeterDisplayState();
    }
    if (removedAnalyzingFile) {
      setFileRunRequest(null);
    }
    setFileHistory((history) => removeFileEntry(history, id));
    setStatus(
      fileHistory.order.length > 1
        ? "File entry removed"
        : "File mode - drop a file or click Analyze"
    );
    resetTimer({ restart: false });
    setShowClock(false);
  };

  const onClearAllFiles = async () => {
    if (fileHistory.analyzingFileId) {
      await stopCurrentFileAnalysis();
    }
    for (const entry of Object.values(fileHistory.sessionsById)) {
      entry.intake?.reset?.();
    }
    clearMeterDisplayState();
    setFileRunRequest(null);
    setFileHistory(clearFileHistory());
    setStatus("File mode - drop a file or click Analyze");
    resetTimer({ restart: false });
    setShowClock(false);
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
      setRunning(false);
      setSelectedOffset(-1);
      setStatus("Stopped - click Start to resume");
      setStatus2("Device: Not connected");
      stopTimer();
      return;
    }
    intakeRef.current.beginCaptureSession();
    setRunning(true);
    startTimer();
    setShowClock(true);
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
      void stopCurrentFileAnalysis();
      return;
    }
  };

  const onStartClick = runLiveStartAction;

  const onSourceModeChange = (nextMode) => {
    if (nextMode === sourceMode) return;
    // Drop the live-driven display state and always wipe the Live ring (every switch starts Live
    // fresh). The File ring is left intact, so switching back to File restores its previous analysis
    // without re-decoding.
    clearMeterDisplayState();
    liveIntakeRef.current.reset();
    if (nextMode === "file") {
      if (running) {
        setRunning(false);
        stopTimer();
        setStatus("Stopped live monitoring - file mode selected");
        setStatus2("Device: Not connected");
      } else {
        setStatus("File mode - drop a file or click Analyze");
      }
      setSourceMode("file");
      return;
    }
    // Leaving File mode: stop an in-progress analysis so its worker does not keep running.
    if (fileHistory.analyzingFileId) {
      void stopCurrentFileAnalysis();
    }
    setSourceMode("live");
    setStatus("Ready - click Start to begin monitoring");
    setStatus2("Device: Not connected");
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

  const shortcutHandlerRef = useRef(null);
  shortcutHandlerRef.current = {
    onStartClick,
    clearAll,
    running,
    showClock,
    setSettingsOpen,
    clearShortcut,
    autoHideControls: focusView.autoHideControls,
    toggleFocusControls,
  };
  useEffect(() => {
    const onKeyDown = (e) => {
      const {
        clearAll: clear,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
        clearShortcut: clearCombo,
        autoHideControls,
        toggleFocusControls: toggleFocus,
      } = shortcutHandlerRef.current;
      const tag = document.activeElement?.tagName ?? "";
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (eventMatchesAccelerator(e, clearCombo)) {
        e.preventDefault();
        if (isRunning || hasClock) clear();
        return;
      }
      if (e.key === "Escape" && autoHideControls && !editable) {
        e.preventDefault();
        toggleFocus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    cleanupLegacyKeys();
  }, []);

  useEffect(() => {
    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

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

  useAudioEngine({
    running,
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples: HIST_MAX_SAMPLES,
    visualMaxSamples: VISUAL_MAX_SAMPLES,
    audioRef,
    rafRef,
    frameRef,
    intake: liveIntakeRef.current,
    selectedOffsetRef,
    defaultSampleRateRef,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    setAudio,
    setHistoryPathM: () => {},
    setHistoryPathST: () => {},
    setStatus,
    setStatus2,
    setRunning,
    setSelectedOffset,
    resetTimer,
    setShowClock,
  });

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
    spectrumViewLegend: spectrumViewLegend(
      spectrumViewUi,
      spectrumChannelUi,
      vectorscopeChannelLabels
    ),
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

  return (
    <AudioDataContext.Provider value={audioData}>
      <FileDropOverlay active={sourceMode === "file"} onDropFile={handleDropFile} />
      <div className={SHELL_PAGE}>
        <div
          className={focusView.autoHideControls ? SHELL_INNER_FOCUS : SHELL_INNER}
          onPointerLeave={focusView.autoHideControls ? hideFocusControlsNow : undefined}
        >
          {focusView.autoHideControls ? (
            <div
              className={SHELL_TOP_REVEAL_HOT_ZONE}
              onPointerEnter={showFocusControls}
              onPointerDown={handleWindowDrag}
              onPointerUp={releaseFocusControlsHold}
              onPointerCancel={releaseFocusControlsHold}
            />
          ) : null}
          {(!focusView.autoHideControls || focusControlsVisible) && (
            <AppHeader
              autoHideControls={focusView.autoHideControls}
              onPointerEnter={focusView.autoHideControls ? showFocusControls : undefined}
              onPointerLeave={focusView.autoHideControls ? hideFocusControlsLater : undefined}
              onPointerDown={frameless ? handleWindowDrag : undefined}
              onPointerUp={frameless ? releaseFocusControlsHold : undefined}
              onPointerCancel={frameless ? releaseFocusControlsHold : undefined}
              sourceTransportState={sourceTransportState}
              sourceMode={sourceMode}
              onSourceModeChange={onSourceModeChange}
              onSourceTransportAction={onSourceTransportAction}
              onClear={clearAll}
              clearDisabled={sourceMode === "file" ? !activeFileSession : !running && !showClock}
              isTauriApp={isTauri()}
              onOpenFile={async () => {
                const path = await pickMediaFile();
                if (path) beginFileAnalysis(path);
              }}
              audioDevices={audioDevices}
              audioOutputs={audioOutputs}
              audioInputs={audioInputs}
              safeAudioDeviceId={safeAudioDeviceId}
              setCaptureDeviceId={setCaptureDeviceIdAndPersist}
              holdFocusControls={holdFocusControls}
              focusView={focusView}
              focusViewActive={focusViewActive}
              pinned={pinned}
              setPinned={setPinned}
              setAutoHideControls={setAutoHideControls}
              setCompactPanels={setCompactPanels}
              setBorderless={setBorderless}
              panelOpacity={panelOpacity}
              setPanelOpacity={setPanelOpacity}
              glassEnabled={glassEnabled}
              setGlassEnabled={setGlassEnabled}
              presets={presets}
              setSettingsOpen={setSettingsOpen}
            />
          )}

          {showFileAnalysisResult ? (
            <div
              className={
                focusView.autoHideControls
                  ? "absolute left-[var(--ui-shell-pad)] right-[var(--ui-shell-pad)] top-[calc(var(--ui-shell-pad)+2.75rem)] z-30"
                  : "shrink-0"
              }
              onPointerEnter={focusView.autoHideControls ? showFocusControls : undefined}
              onPointerLeave={focusView.autoHideControls ? hideFocusControlsLater : undefined}
            >
              <FileAnalysisSummary
                fileSession={fileSession}
                fileSessions={fileSessions}
                activeFileId={fileHistory.activeFileId}
                analyzingFileId={fileHistory.analyzingFileId}
                onSelectFile={onSelectFile}
                onReanalyzeFile={onReanalyzeFile}
                onRemoveFile={onRemoveFile}
                onClearAllFiles={onClearAllFiles}
                onStopFile={onStopFile}
                onExportReport={exportFileAnalysisReport}
              />
            </div>
          ) : null}

          <SplitLayout />

          {(!focusView.autoHideControls || focusControlsVisible) && (
            <footer
              className={focusView.autoHideControls ? SHELL_FOOTER_OVERLAY : SHELL_FOOTER}
              onPointerEnter={focusView.autoHideControls ? showFocusControls : undefined}
              onPointerLeave={focusView.autoHideControls ? hideFocusControlsLater : undefined}
            >
              <span className={FOOTER_LABEL}>Device</span>
              <span className={FOOTER_VALUE}>{footerDeviceLabel}</span>
              <div className={FOOTER_DIVIDER} />
              <span className={FOOTER_LABEL}>Ref</span>
              <span className={FOOTER_VALUE}>{referenceLufs} LUFS</span>
              <div className={FOOTER_DIVIDER} />
              <span className={FOOTER_LABEL}>Preset</span>
              <span className={FOOTER_VALUE}>{activePresetName}</span>
              {updateInfo?.hasUpdate ? (
                <>
                  <div className={FOOTER_DIVIDER} />
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="min-w-0 truncate text-[length:var(--ui-fs-status)] text-primary hover:underline"
                  >
                    Update available · Check in Settings
                  </button>
                </>
              ) : null}
            </footer>
          )}
          {focusView.autoHideControls ? (
            <div className={SHELL_BOTTOM_REVEAL_HOT_ZONE} onPointerEnter={showFocusControls} />
          ) : null}
        </div>

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
      </div>
    </AudioDataContext.Provider>
  );
}
