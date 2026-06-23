import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import { AudioDataContext } from "./workspace/AudioDataContext.jsx";
import { FrameIntake } from "./lib/FrameIntake.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { settingsStore } from "./persistence/index.js";
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
  sanitizeChannelLabelOverrides,
  seedTokensFromLabels,
} from "./math/channelRoles.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeEditor } from "./components/ThemeEditor";
import { SourceTransportCluster } from "./components/SourceTransportCluster.jsx";
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
import { IconButton } from "./components/IconButton.jsx";
import { SplitLayout } from "./workspace/SplitLayout.jsx";
import { ModulesPopoverContent } from "./workspace/WorkspaceToolbar.jsx";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { deriveClampedPanelControls } from "./workspace/clampPanelControls.js";
import { deriveAnalysisRequests } from "./analysis/analysisRequests.js";
import { PresetsPopoverContent } from "./components/PresetsPopover.jsx";
import { FocusViewPopoverContent } from "./components/FocusViewPopover.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { eventMatchesAccelerator } from "./lib/accelerator.js";
import {
  SHELL_BOTTOM_REVEAL_HOT_ZONE,
  SHELL_FOOTER,
  SHELL_FOOTER_OVERLAY,
  SHELL_HEADER,
  SHELL_HEADER_OVERLAY,
  SHELL_INNER,
  SHELL_INNER_FOCUS,
  SHELL_PAGE,
  SHELL_TOP_REVEAL_HOT_ZONE,
} from "@/lib/shellLayout";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { Bookmark, Focus, FolderOpen, LayoutGrid, Settings, Trash2, Volume2 } from "lucide-react";
import { isTauri } from "./ipc/env.js";
import {
  clearAudioHistory,
  setAnalysisRequests,
  setLoudnessWeights,
  setDialogueGating,
} from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { openExternalUrl } from "./ipc/openExternal.js";
import { pickMediaFile } from "./ipc/fileDialog.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useFocusViewWindow } from "./hooks/useFocusViewWindow.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
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
    })),
    vectorscope: requests.vectorscopeRequests.map((request) => ({
      key: request.key,
      x: request.pair.x,
      y: request.pair.y,
    })),
  };
}

function DeviceRow({ primary, secondary, selected, onSelect, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          selected ? "bg-primary" : "bg-muted-foreground/20"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-muted-foreground/70">{secondary}</span>
        ) : null}
      </span>
    </button>
  );
}

function AudioDeviceOption({ device, selected, onSelect }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <DeviceRow
      ariaLabel={label.full}
      primary={label.primary}
      secondary={label.secondary}
      selected={selected}
      onSelect={onSelect}
    />
  );
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
  const {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearanceMode,
    fixedThemeSelectValue,
    setFixedThemeIdFromPicker,
    themeSelectOptions,
    resolvedThemeId,
    referenceLufs,
    setReferenceLufs,
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
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    createCustomTheme,
    editActiveCustomTheme,
    deleteCustomTheme,
    activeIsCustom,
  } = useSettings({ onClearRef });
  const { pinned, setPinned, togglePin } = useAlwaysOnTop();
  const presets = usePresets({
    windowPinned: pinned,
    setWindowPinned: setPinned,
    focusView,
    setFocusView,
  });
  useFocusViewWindow(focusView.autoHideControls);

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
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    spectrumResultsByKey: {},
    vectorscopeResultsByKey: {},
  });
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck(APP_VERSION);
  const [channelLabelOverrides, setChannelLabelOverrides] = useState({});
  const [focusControlsVisible, setFocusControlsVisible] = useState(false);
  const [focusControlsHeld, setFocusControlsHeld] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const handleDeviceSelect = (id) => {
    setCaptureDeviceIdAndPersist(id);
    setDevicesOpen(false);
  };
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
    () => normalizedPanelControls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id)),
    [normalizedPanelControls.statsVisibleIds]
  );
  const dialogueGatingRef = useRef(dialogueGating);
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
    dialogueGatingRef.current = dialogueGating;
    if (!isTauri() || !running) return;
    void setDialogueGating(dialogueGating);
  }, [dialogueGating, running]);

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
  const activePresetName =
    presets.list.find((preset) => preset.id === presets.activeId)?.name ?? "-";
  const focusViewActive = pinned || focusView.autoHideControls || focusView.compactPanels;

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

  const handleWindowDrag = useCallback(
    async (event) => {
      if (!focusView.autoHideControls || event.button !== 0 || event.target !== event.currentTarget)
        return;
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
    [focusView.autoHideControls, holdFocusControls, releaseFocusControlsHold]
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

      setSelectedOffset(-1);
      selectedOffsetRef.current = -1;
      setFileHistory((history) =>
        startFileAnalysisEntry(
          addFileEntry(history, {
            id: sessionId,
            path,
            intake,
          }),
          sessionId
        )
      );
      setFileRunRequest({ sessionId, filePath: path, runId });
    },
    [fileHistory.analyzingFileId, setSelectedOffset]
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
      setSelectedOffset(-1);
      selectedOffsetRef.current = -1;
      setFileHistory((history) => startFileAnalysisEntry(history, entry.id));
      setFileRunRequest({ sessionId: entry.id, filePath: entry.path, runId });
    },
    [fileHistory.analyzingFileId, setSelectedOffset]
  );

  const onSelectFile = (id) => {
    setSelectedOffset(-1);
    selectedOffsetRef.current = -1;
    clearMeterDisplayState();
    setFileHistory((history) => selectFileEntry(history, id));
    setStatus("File analysis result");
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
        onStartClick: start,
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
      if (e.code === "Space" && !editable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        start();
        return;
      }
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
    const s = settingsStore.read();
    setChannelLabelOverrides(sanitizeChannelLabelOverrides(s.channelLabelOverrides));
  }, []);

  useEffect(() => {
    cleanupLegacyKeys();
  }, []);

  useEffect(() => {
    settingsStore.patch({
      referenceLufs,
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
      channelLabelOverrides,
    });
  }, [referenceLufs, appearance, fixedThemeSelectValue, channelLabelOverrides]);

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
            <header
              className={focusView.autoHideControls ? SHELL_HEADER_OVERLAY : SHELL_HEADER}
              onPointerEnter={focusView.autoHideControls ? showFocusControls : undefined}
              onPointerLeave={focusView.autoHideControls ? hideFocusControlsLater : undefined}
              onPointerDown={focusView.autoHideControls ? handleWindowDrag : undefined}
              onPointerUp={focusView.autoHideControls ? releaseFocusControlsHold : undefined}
              onPointerCancel={focusView.autoHideControls ? releaseFocusControlsHold : undefined}
            >
              <SourceTransportCluster
                state={sourceTransportState}
                sourceMode={sourceMode}
                onSourceModeChange={onSourceModeChange}
                onPrimaryAction={onSourceTransportAction}
              />
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <IconButton
                  icon={<Trash2 className="size-3.5" />}
                  tip="Clear"
                  disabled={sourceMode === "file" ? !activeFileSession : !running && !showClock}
                  onClick={clearAll}
                />
                {isTauri() &&
                  (sourceMode === "file" ? (
                    // Reuse the Devices slot (meaningless in File mode) as a re-import affordance,
                    // mirroring the ANALYZE picker without adding a new toolbar control.
                    <IconButton
                      icon={<FolderOpen className="size-4 shrink-0" />}
                      tip="Open file"
                      onClick={async () => {
                        const path = await pickMediaFile();
                        if (path) beginFileAnalysis(path);
                      }}
                    />
                  ) : (
                    <Popover
                      open={devicesOpen}
                      onOpenChange={(open) => {
                        if (open && !audioDevices.length) return;
                        setDevicesOpen(open);
                        if (focusView.autoHideControls) holdFocusControls(open);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <span>
                          <IconButton
                            icon={<Volume2 className="size-4 shrink-0" />}
                            tip="Devices"
                            disabled={!audioDevices.length}
                          />
                        </span>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={6}
                        className="w-auto max-w-[92vw] p-1"
                      >
                        <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                          Devices
                        </p>
                        <DeviceRow
                          ariaLabel="Automatic (default system output)"
                          primary="Automatic (default system output)"
                          selected={safeAudioDeviceId === "default"}
                          onSelect={() => handleDeviceSelect("default")}
                        />
                        {audioOutputs.length ? (
                          <>
                            <p className="px-2 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground/70">
                              Output
                            </p>
                            {audioOutputs.map((d) => (
                              <AudioDeviceOption
                                key={d.id}
                                device={d}
                                selected={safeAudioDeviceId === d.id}
                                onSelect={() => handleDeviceSelect(d.id)}
                              />
                            ))}
                          </>
                        ) : null}
                        {audioInputs.length ? (
                          <>
                            <p className="px-2 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground/70">
                              Input
                            </p>
                            {audioInputs.map((d) => (
                              <AudioDeviceOption
                                key={d.id}
                                device={d}
                                selected={safeAudioDeviceId === d.id}
                                onSelect={() => handleDeviceSelect(d.id)}
                              />
                            ))}
                          </>
                        ) : null}
                      </PopoverContent>
                    </Popover>
                  ))}
                <Popover onOpenChange={focusView.autoHideControls ? holdFocusControls : undefined}>
                  <PopoverTrigger asChild>
                    <span>
                      <IconButton icon={<LayoutGrid className="size-3.5" />} tip="Modules" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={6}
                    className="w-max min-w-44 max-w-[92vw] p-1"
                  >
                    <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                      Modules
                    </p>
                    <ModulesPopoverContent />
                  </PopoverContent>
                </Popover>
                <Popover onOpenChange={focusView.autoHideControls ? holdFocusControls : undefined}>
                  <PopoverTrigger asChild>
                    <span>
                      <IconButton
                        icon={<Focus className="size-3.5" />}
                        tip="Focus View"
                        className={focusViewActive ? "text-foreground" : undefined}
                      />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={6} className="w-56 p-1">
                    <FocusViewPopoverContent
                      pinned={pinned}
                      setPinned={setPinned}
                      focusView={focusView}
                      setAutoHideControls={setAutoHideControls}
                      setCompactPanels={setCompactPanels}
                    />
                  </PopoverContent>
                </Popover>
                <Popover onOpenChange={focusView.autoHideControls ? holdFocusControls : undefined}>
                  <PopoverTrigger asChild>
                    <span>
                      <IconButton icon={<Bookmark className="size-3.5" />} tip="Presets" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
                    <PresetsPopoverContent presets={presets} />
                  </PopoverContent>
                </Popover>
                <IconButton
                  icon={<Settings className="size-3.5" />}
                  tip="Settings"
                  onClick={() => setSettingsOpen(true)}
                />
              </div>
            </header>
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
              <span className="text-[10px] tracking-[0.06em] text-muted-foreground/60">Device</span>
              <span
                className={cn(
                  "min-w-0 truncate tabular-nums",
                  deviceDisplay ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {footerDeviceLabel}
              </span>
              <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
              <span className="text-[10px] tracking-[0.06em] text-muted-foreground/60">Ref</span>
              <span className="min-w-0 truncate tabular-nums text-foreground">
                {referenceLufs} LUFS
              </span>
              <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
              <span className="text-[10px] tracking-[0.06em] text-muted-foreground/60">Preset</span>
              <span className="min-w-0 truncate tabular-nums text-foreground">
                {activePresetName}
              </span>
              {updateInfo?.hasUpdate ? (
                <>
                  <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="min-w-0 truncate text-xs text-primary hover:underline"
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
          referenceLufs={referenceLufs}
          setReferenceLufs={setReferenceLufs}
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
          openReleaseUrl={openExternalUrl}
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
        />

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
