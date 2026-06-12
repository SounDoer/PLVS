import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import { AudioDataContext } from "./workspace/AudioDataContext.jsx";
import { FrameIntake } from "./lib/FrameIntake.js";
import { UI_PREFERENCES } from "./uiPreferences";
import {
  normalizePanelControls,
  readPersistedPanelControls,
  stripLegacyChannelPreferenceKeys,
  writePersistedPanelControls,
} from "./lib/panelControls.js";
import { HISTORY_MAX_WINDOW_SEC, HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./hooks/useLoudnessHistory.js";
import { useLayoutDrag } from "./hooks/useLayoutDrag";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { useSessionTimer } from "./hooks/useSessionTimer.js";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
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
import {
  roleTokensToLabels,
  roleTokensToLoudnessWeights,
  sanitizeChannelLabelOverrides,
  seedTokensFromLabels,
} from "./math/channelRoles.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusPill } from "./components/StatusPill.jsx";
import { TransportButton } from "./components/TransportButton.jsx";
import { IconButton } from "./components/IconButton.jsx";
import { SplitLayout } from "./workspace/SplitLayout.jsx";
import { VisibilityPopoverContent, PresetDropdownContent } from "./workspace/WorkspaceToolbar.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { eventMatchesAccelerator } from "./lib/accelerator.js";
import { SHELL_FOOTER, SHELL_HEADER, SHELL_INNER, SHELL_PAGE } from "@/lib/shellLayout";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { LayoutGrid, Pin, PinOff, Settings, Trash2, Volume2 } from "lucide-react";
import { isTauri } from "./ipc/env.js";
import {
  clearAudioHistory,
  setLoudnessWeights,
  setVectorscopePair,
  setSpectrumChannel,
} from "./ipc/commands.js";
import { openExternalUrl } from "./ipc/openExternal.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import packageInfo from "../package.json";

const HIST_MAX_SAMPLES = 72000;
const VISUAL_MAX_SAMPLES = 180_000; // 25 Hz × 2 h

const STORE_KEY = UI_PREFERENCES.layoutPersistKey;
const APP_VERSION = packageInfo.version;

function AudioDeviceOption({ device }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <SelectItem key={device.id} value={device.id} className="min-w-0 py-2">
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{label.primary}</span>
        {label.secondary ? (
          <span className="mt-0.5 truncate text-xs text-muted-foreground/70">
            {label.secondary}
          </span>
        ) : null}
      </span>
    </SelectItem>
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
  const { state: workspaceState, setPanelControls: setWorkspacePanelControls } =
    useWorkspaceStore();
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
  } = useSettings({ onClearRef });

  const {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = useAudioDevices();

  const { pinned, togglePin } = useAlwaysOnTop();

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

  const { clockRef, canClearRef, startTimer, stopTimer, resetTimer } = useSessionTimer();
  const [showClock, setShowClock] = useState(false);

  const [running, setRunning] = useState(false);
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [status, setStatus] = useState("Ready - click Start to begin monitoring");
  const [status2, setStatus2] = useState("Device: Not connected");
  const [panelControls, setPanelControlsState] = useState(() => readPersistedPanelControls());
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
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
  });
  const [spectrumPath, setSpectrumPath] = useState("");
  const [spectrumPeakPath, setSpectrumPeakPath] = useState("");
  const [vectorPath, setVectorPath] = useState("");
  const [mainLeft, setMainLeft] = useState(UI_PREFERENCES.layout.mainColumn.initialPx);
  const [leftTopRatio, setLeftTopRatio] = useState(UI_PREFERENCES.layout.leftSplit.initialRatio);
  const [rightTopRatio, setRightTopRatio] = useState(UI_PREFERENCES.layout.rightSplit.initialRatio);
  const [spectrogramTopRatio, setSpectrogramTopRatio] = useState(
    UI_PREFERENCES.layout.spectrogramSplit.initialRatio
  );
  const [loudnessHistWidthRatio, setLoudnessHistWidthRatio] = useState(
    UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio
  );
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck(APP_VERSION);
  const [channelLabelOverrides, setChannelLabelOverrides] = useState({});

  const audioRef = useRef(null);
  const spectrumStateRef = useRef({ smoothDb: [], peakDb: [], peakHoldUntil: [] });
  const spectrumTimeRef = useRef(0);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const intakeRef = useRef(new FrameIntake());
  // Stable ref-compatible accessor for SpectrogramPanel (reads snapDataSnap from intake).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spectrogramSnapRef = useMemo(
    () => ({
      get current() {
        return intakeRef.current.getSpectrogramSnapArray();
      },
    }),
    []
  );
  const frequencyMarkerRef = useMemo(
    () => ({
      get current() {
        return intakeRef.current.getFrequencyChannelMarkers();
      },
    }),
    []
  );
  const selectedOffsetRef = useRef(-1);
  const vectorscopePairRef = useRef(vectorscopePairUi);
  const spectrumChannelRef = useRef(spectrumChannelUi);
  const pendingVectorscopePairSyncRef = useRef(null);
  const lastSentVectorscopePairKeyRef = useRef("");
  const lastSentSpectrumChannelKeyRef = useRef("");
  const workspacePanelControls = useMemo(
    () => normalizePanelControls(workspaceState.panelControls),
    [workspaceState.panelControls]
  );
  const panelControlsKey = useMemo(
    () => JSON.stringify(normalizedPanelControls),
    [normalizedPanelControls]
  );
  const workspacePanelControlsKey = useMemo(
    () => JSON.stringify(workspacePanelControls),
    [workspacePanelControls]
  );
  const lastSyncedPanelControlsKeyRef = useRef(workspacePanelControlsKey);

  const updatePanelControls = useCallback((nextPanelControls) => {
    setPanelControlsState((current) =>
      normalizePanelControls(
        typeof nextPanelControls === "function" ? nextPanelControls(current) : nextPanelControls
      )
    );
  }, []);
  const sendTrackedVectorscopePair = useCallback((pair) => {
    const key = `${pair.x}-${pair.y}`;
    lastSentVectorscopePairKeyRef.current = key;
    pendingVectorscopePairSyncRef.current = { x: pair.x, y: pair.y };
    return setVectorscopePair({ x: pair.x, y: pair.y }).catch(() => {
      if (lastSentVectorscopePairKeyRef.current === key) lastSentVectorscopePairKeyRef.current = "";
    });
  }, []);
  const sendTrackedSpectrumChannel = useCallback((sel) => {
    const key = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
    lastSentSpectrumChannelKeyRef.current = key;
    return setSpectrumChannel(sel).catch(() => {
      if (lastSentSpectrumChannelKeyRef.current === key) lastSentSpectrumChannelKeyRef.current = "";
    });
  }, []);
  const sendTrackedLoudnessWeights = useCallback((weights) => {
    return setLoudnessWeights(weights).catch(() => {});
  }, []);

  useEffect(() => {
    writePersistedPanelControls(normalizedPanelControls);
  }, [normalizedPanelControls]);

  useEffect(() => {
    if (workspacePanelControlsKey !== lastSyncedPanelControlsKeyRef.current) {
      lastSyncedPanelControlsKeyRef.current = workspacePanelControlsKey;
      if (workspacePanelControlsKey !== panelControlsKey) {
        setPanelControlsState(workspacePanelControls);
      }
      return;
    }

    if (panelControlsKey !== lastSyncedPanelControlsKeyRef.current) {
      lastSyncedPanelControlsKeyRef.current = panelControlsKey;
      setWorkspacePanelControls(normalizedPanelControls);
    }
  }, [
    normalizedPanelControls,
    panelControlsKey,
    setWorkspacePanelControls,
    workspacePanelControls,
    workspacePanelControlsKey,
  ]);

  const {
    histSourceList,
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    correlation,
    channelMetadata,
    visualWaveformSnap,
    visualSnapIdx,
    visualSpectrogramSnap,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: intakeRef.current,
    audio,
    spectrumPath,
    spectrumPeakPath,
    vectorPath,
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
    primaryMetrics,
    secondaryMetrics,
  } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceLufs,
    selectedOffset,
  });

  const { fmt, getSamplePeakLineColor, hasTpMaxValue, tpMaxText } = usePeakVis(
    resolvedThemeId,
    displayAudio
  );
  const vsGridDiagInset = useMemo(() => {
    const pct = getBuiltinTheme(resolvedThemeId).charts.vectorscope.gridDiagInsetPct ?? 0;
    return Math.max(0, Math.min(20, pct));
  }, [resolvedThemeId]);
  const vsGridDiagFar = 100 - vsGridDiagInset;
  const startMode = selectedOffset >= 0 ? "live" : running ? "stop" : "start";
  // Maps old startMode values to new 3-state chrome vocabulary
  const chromeState = startMode === "stop" ? "live" : startMode === "live" ? "snapshot" : "ready";
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

  const peakLabelContext = useMemo(
    () => ({ channelLayout: "auto", resolvedLayout: layoutResolution.resolved, overrideLabels }),
    [layoutResolution.resolved, overrideLabels]
  );

  const vectorscopeLabelContext = useMemo(
    () => ({ channelLayout: "auto", resolvedLayout: layoutResolution.resolved, overrideLabels }),
    [layoutResolution.resolved, overrideLabels]
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
    return buildVectorscopePairOptions(n, vectorscopeLabelContext);
  }, [channelCount, vectorscopeLabelContext]);

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
    vectorscopeLabelContext
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

  useEffect(() => {
    if (!running || !isTauri()) return;
    const next = clampVectorscopePairToAvailable(
      vectorscopePairUi,
      channelCount,
      vectorscopeLabelContext
    );
    if (next.x !== vectorscopePairUi.x || next.y !== vectorscopePairUi.y) return;
    const key = `${vectorscopePairUi.x}-${vectorscopePairUi.y}`;
    if (lastSentVectorscopePairKeyRef.current === key) return;
    void sendTrackedVectorscopePair(vectorscopePairUi);
  }, [
    channelCount,
    running,
    sendTrackedVectorscopePair,
    vectorscopeLabelContext,
    vectorscopePairUi,
    vectorscopePairUi.x,
    vectorscopePairUi.y,
  ]);

  useEffect(() => {
    if (!running || selectedOffset >= 0) return;
    const x = Number.isFinite(displayAudio?.vectorscopePairX)
      ? Number(displayAudio.vectorscopePairX)
      : 0;
    const y = Number.isFinite(displayAudio?.vectorscopePairY)
      ? Number(displayAudio.vectorscopePairY)
      : 1;
    const pendingPair = pendingVectorscopePairSyncRef.current;
    if (pendingPair && (pendingPair.x !== x || pendingPair.y !== y)) return;
    if (pendingPair) pendingVectorscopePairSyncRef.current = null;
    updatePanelControls((current) => {
      if (current.vectorscopePair.x === x && current.vectorscopePair.y === y) return current;
      return { ...current, vectorscopePair: { x, y } };
    });
  }, [
    running,
    selectedOffset,
    displayAudio?.vectorscopePairX,
    displayAudio?.vectorscopePairY,
    updatePanelControls,
  ]);

  useEffect(() => {
    const next = clampVectorscopePairToAvailable(
      vectorscopePairUi,
      channelCount,
      vectorscopeLabelContext
    );
    if (next.x === vectorscopePairUi.x && next.y === vectorscopePairUi.y) return;
    updatePanelControls((current) => ({ ...current, vectorscopePair: next }));
    if (isTauri() && running) void sendTrackedVectorscopePair(next);
  }, [
    channelCount,
    sendTrackedVectorscopePair,
    vectorscopeLabelContext,
    vectorscopePairUi.x,
    vectorscopePairUi.y,
    running,
    updatePanelControls,
  ]);

  useEffect(() => {
    const next = clampSpectrumChannelToAvailable(spectrumChannelUi, spectrumChannelOptions);
    const curKey =
      spectrumChannelUi.type === "pair"
        ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
        : `s-${spectrumChannelUi.ch}`;
    const nxtKey = next.type === "pair" ? `p-${next.x}-${next.y}` : `s-${next.ch}`;
    if (curKey === nxtKey) return;
    updatePanelControls((current) => ({ ...current, spectrumChannel: next }));
    if (isTauri() && running) void sendTrackedSpectrumChannel(next);
  }, [
    spectrumChannelUi,
    spectrumChannelOptions,
    running,
    sendTrackedSpectrumChannel,
    updatePanelControls,
  ]);

  useEffect(() => {
    if (!running || !isTauri()) return;
    const next = clampSpectrumChannelToAvailable(spectrumChannelUi, spectrumChannelOptions);
    const curKey =
      spectrumChannelUi.type === "pair"
        ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
        : `s-${spectrumChannelUi.ch}`;
    const nxtKey = next.type === "pair" ? `p-${next.x}-${next.y}` : `s-${next.ch}`;
    if (curKey !== nxtKey || lastSentSpectrumChannelKeyRef.current === curKey) return;
    void sendTrackedSpectrumChannel(spectrumChannelUi);
  }, [running, sendTrackedSpectrumChannel, spectrumChannelOptions, spectrumChannelUi]);

  const onVectorscopePairChange = async (pair) => {
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
    if (!isTauri()) return;
    try {
      if (running) {
        await sendTrackedVectorscopePair(pair);
      } else {
        await setVectorscopePair({ x: pair.x, y: pair.y });
      }
    } catch (_) {}
  };

  const onSpectrumChannelChange = async (sel) => {
    const prevLabel = spectrumLiveLabel;
    const nextKey = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
    const nextLabel = spectrumChannelOptions.find((o) => o.key === nextKey)?.label ?? prevLabel;
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: nextLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumChannel: sel }));
    spectrumChannelRef.current = sel;
    if (running && prevLabel !== nextLabel) {
      intakeRef.current.setPendingFrequencyMarker({ from: prevLabel, to: nextLabel });
    }
    if (!isTauri()) return;
    try {
      if (running) {
        await sendTrackedSpectrumChannel(sel);
      } else {
        await setSpectrumChannel(sel);
      }
    } catch (_) {}
  };

  useEffect(() => {
    vectorscopePairRef.current = vectorscopePairUi;
  }, [vectorscopePairUi]);

  useEffect(() => {
    spectrumChannelRef.current = spectrumChannelUi;
  }, [spectrumChannelUi]);

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

  const { beginLayoutDrag, onLayoutDragMove, onLayoutDragUp } = useLayoutDrag({
    preferences: UI_PREFERENCES,
    mainLeft,
    leftTopRatio,
    rightTopRatio,
    loudnessHistWidthRatio,
    spectrogramTopRatio,
    setMainLeft,
    setLeftTopRatio,
    setRightTopRatio,
    setLoudnessHistWidthRatio,
    setSpectrogramTopRatio,
  });

  const clearAll = async () => {
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
    intakeRef.current.reset();
    spectrumStateRef.current = { smoothDb: [], peakDb: [], peakHoldUntil: [] };
    spectrumTimeRef.current = 0;
    setSpectrumPath("");
    setSpectrumPeakPath("");
    setVectorPath("");
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
    setStatus(
      running
        ? "Running - cleared history and peak hold"
        : "Ready - click Start to begin monitoring"
    );
    resetTimer({ restart: running });
    setShowClock(running);
  };
  onClearRef.current = clearAll;

  const onStartClick = () => {
    if (selectedOffset >= 0)
      return void (setSelectedOffset(-1), setStatus("Monitoring live input"));
    if (running) {
      setRunning(false);
      setSelectedOffset(-1);
      setStatus("Stopped - click Start to resume");
      setStatus2("Device: Not connected");
      stopTimer();
      return;
    }
    setRunning(true);
    startTimer();
    setShowClock(true);
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
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.mainLeft === "number") setMainLeft(s.mainLeft);
      if (typeof s.leftTopRatio === "number") setLeftTopRatio(s.leftTopRatio);
      if (typeof s.rightTopRatio === "number") setRightTopRatio(s.rightTopRatio);
      if (typeof s.loudnessHistWidthRatio === "number")
        setLoudnessHistWidthRatio(s.loudnessHistWidthRatio);
      if (typeof s.spectrogramTopRatio === "number") setSpectrogramTopRatio(s.spectrogramTopRatio);
      setChannelLabelOverrides(sanitizeChannelLabelOverrides(s.channelLabelOverrides));
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      let prev = {};
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) prev = JSON.parse(raw);
      const nextPersisted = stripLegacyChannelPreferenceKeys(prev);
      const persistedThemeId = appearance === "system" ? null : fixedThemeSelectValue;
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          ...nextPersisted,
          mainLeft,
          leftTopRatio,
          rightTopRatio,
          loudnessHistWidthRatio,
          spectrogramTopRatio,
          referenceLufs,
          appearance,
          themeId: persistedThemeId,
          channelLabelOverrides,
        })
      );
    } catch (_) {}
  }, [
    mainLeft,
    leftTopRatio,
    rightTopRatio,
    loudnessHistWidthRatio,
    spectrogramTopRatio,
    referenceLufs,
    appearance,
    fixedThemeSelectValue,
    channelLabelOverrides,
  ]);

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
    spectrumStateRef,
    spectrumTimeRef,
    rafRef,
    frameRef,
    intake: intakeRef.current,
    selectedOffsetRef,
    vectorscopePairRef,
    spectrumChannelRef,
    loudnessWeightsRef,
    setAudio,
    setSpectrumPath,
    setSpectrumPeakPath,
    setVectorPath,
    setHistoryPathM: () => {},
    setHistoryPathST: () => {},
    setStatus,
    setStatus2,
    setRunning,
    setSelectedOffset,
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
    displayVectorPath,
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
    primaryMetrics,
    secondaryMetrics,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    // Spectrum
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    spectrumChannelOptions,
    spectrumValueKey,
    spectrumDisplayLabel,
    onSpectrumChannelChange,
    // Spectrogram
    spectrogramSnapRef,
    frequencyMarkerRef,
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
    histSourceList,
    visualWaveformSnap,
    visualSnapIdx,
    visualSpectrogramSnap,
    loudnessStatsVisibleIds: normalizedPanelControls.loudnessStatsVisibleIds,
    loudnessHistoryVisibleLayerIds: normalizedPanelControls.loudnessHistoryVisibleLayerIds,
  };

  return (
    <AudioDataContext.Provider value={audioData}>
      <div className={SHELL_PAGE}>
        <div className={SHELL_INNER}>
          <header className={SHELL_HEADER}>
            <StatusPill state={chromeState} showClock={showClock} clockRef={clockRef} />
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <TransportButton state={chromeState} onClick={onStartClick} />
              <div className="mx-1 h-[18px] w-px shrink-0 bg-border" />
              <IconButton
                icon={<Trash2 className="size-3.5" />}
                tip="Clear"
                disabled={!running && !showClock}
                onClick={clearAll}
              />
              {isTauri() && (
                <div className="relative group">
                  <Select
                    value={safeAudioDeviceId}
                    onValueChange={(v) => setCaptureDeviceIdAndPersist(v)}
                    disabled={!audioDevices.length}
                  >
                    <SelectTrigger
                      className="flex items-center justify-center size-8 rounded-md text-muted-foreground bg-transparent border-0 shadow-none hover:bg-secondary hover:text-foreground transition-colors duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0"
                      aria-label="Audio device"
                    >
                      <Volume2 className="size-4 shrink-0" />
                    </SelectTrigger>
                    <SelectContent align="end" sideOffset={6} className="w-[min(28rem,92vw)]">
                      <SelectItem value="default">Automatic (default system output)</SelectItem>
                      {audioOutputs.length ? (
                        <SelectGroup>
                          <SelectLabel>Output</SelectLabel>
                          {audioOutputs.map((d) => (
                            <AudioDeviceOption key={d.id} device={d} />
                          ))}
                        </SelectGroup>
                      ) : null}
                      {audioInputs.length ? (
                        <SelectGroup>
                          <SelectLabel>Input</SelectLabel>
                          {audioInputs.map((d) => (
                            <AudioDeviceOption key={d.id} device={d} />
                          ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-100 delay-100 text-[11px] text-foreground bg-popover border border-white/10 rounded px-2 py-1 whitespace-nowrap shadow-md">
                    Audio device
                  </span>
                </div>
              )}
              {isTauri() && (
                <IconButton
                  icon={pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  tip={pinned ? "Unpin window" : "Pin window on top"}
                  onClick={togglePin}
                  className={pinned ? "text-foreground" : undefined}
                />
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <span>
                    <IconButton icon={<LayoutGrid className="size-3.5" />} tip="Layout & modules" />
                  </span>
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="w-52 p-1">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Modules
                  </p>
                  <VisibilityPopoverContent />
                  <div className="my-1 h-px bg-border/50" />
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Presets
                  </p>
                  <PresetDropdownContent />
                </PopoverContent>
              </Popover>
              <IconButton
                icon={<Settings className="size-3.5" />}
                tip="Settings"
                onClick={() => setSettingsOpen(true)}
              />
            </div>
          </header>

          <SplitLayout />

          <footer className={SHELL_FOOTER}>
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground/60">
              Device
            </span>
            <span
              className={cn(
                "min-w-0 truncate tabular-nums",
                deviceDisplay ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {footerDeviceLabel}
            </span>
            <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground/60">
              Ref
            </span>
            <span className="min-w-0 truncate tabular-nums text-foreground">
              {referenceLufs} LUFS
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
        />

        <CloseConfirmDialog
          open={closeDialogOpen}
          onConfirm={handleCloseConfirm}
          onCancel={handleCloseCancel}
        />
      </div>
    </AudioDataContext.Provider>
  );
}
