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
import { useHoverState } from "./hooks/useHoverState";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { useSessionTimer } from "./hooks/useSessionTimer.js";
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
import { SHELL_FOOTER, SHELL_HEADER, SHELL_INNER, SHELL_PAGE } from "@/lib/shellLayout";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { LayoutGrid, Settings, Trash2, Volume2 } from "lucide-react";
import { isTauri } from "./ipc/env.js";
import { clearAudioHistory, setVectorscopePair, setSpectrumChannel } from "./ipc/commands.js";
import { openExternalUrl } from "./ipc/openExternal.js";
import { checkForUpdate } from "./lib/updateCheck.js";
import packageInfo from "../package.json";

const HIST_MAX_SAMPLES = 36000;

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
  } = useSettings();

  const {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = useAudioDevices();

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

  const { clockRef, canClearRef, startTimer, stopTimer, resetTimer } = useSessionTimer();
  const [showClock, setShowClock] = useState(false);

  const [running, setRunning] = useState(false);
  const [channelLayout, setChannelLayout] = useState("auto");
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
  const [updateInfo, setUpdateInfo] = useState(null);

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
        return intakeRef.current.getSpectrumDataSnap();
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
    () => resolveChannelLayout(channelLayout, { channelCount }),
    [channelLayout, channelCount]
  );
  const peakLabelContext = useMemo(
    () => ({ channelLayout, resolvedLayout: layoutResolution.resolved }),
    [channelLayout, layoutResolution.resolved]
  );

  const vectorscopeLabelContext = useMemo(
    () => ({ channelLayout, resolvedLayout: layoutResolution.resolved }),
    [channelLayout, layoutResolution.resolved]
  );
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
    historyHover,
    spectrumHover,
    onHistoryHoverMove,
    onHistoryHoverLeave,
    onSpectrumHoverMove,
    onSpectrumHoverLeave,
    clearHoverState,
  } = useHoverState({
    historyChartInteractive,
    histSourceList,
    effectiveOffsetSamples,
    visibleSamples,
    sampleSec: HIST_SAMPLE_SEC,
    displaySpectrumData,
  });

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
    clearHoverState();
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
    stopTimer();
    resetTimer();
    setShowClock(false);
    if (running) {
      setRunning(false);
      setSelectedOffset(-1);
    }
  };

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

  const shortcutHandlerRef = useRef(null);
  shortcutHandlerRef.current = { onStartClick, clearAll, running, showClock, setSettingsOpen };
  useEffect(() => {
    const onKeyDown = (e) => {
      const {
        onStartClick: start,
        clearAll: clear,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
      } = shortcutHandlerRef.current;
      const tag = document.activeElement?.tagName ?? "";
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (e.code === "Space" && !editable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        start();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
      if (
        s.channelLayout === "auto" ||
        s.channelLayout === "stereo" ||
        s.channelLayout === "5.1" ||
        s.channelLayout === "7.1"
      )
        setChannelLayout(s.channelLayout);
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
          channelLayout,
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
    channelLayout,
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

  // Silent update check on startup
  useEffect(() => {
    let cancelled = false;
    checkForUpdate(APP_VERSION).then((info) => {
      if (!cancelled && info) setUpdateInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useAudioEngine({
    running,
    captureDeviceId,
    captureFormatSignature,
    channelLayout,
    histMaxSamples: HIST_MAX_SAMPLES,
    audioRef,
    spectrumStateRef,
    spectrumTimeRef,
    rafRef,
    frameRef,
    intake: intakeRef.current,
    selectedOffsetRef,
    vectorscopePairRef,
    spectrumChannelRef,
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
    historyHover,
    historyTimeTicks,
    primaryMetrics,
    secondaryMetrics,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryHoverMove,
    onHistoryHoverLeave,
    // Spectrum
    displaySpectrumPath,
    displaySpectrumPeakPath,
    spectrumChannelOptions,
    spectrumValueKey,
    spectrumDisplayLabel,
    onSpectrumChannelChange,
    spectrumHover,
    onSpectrumHoverMove,
    onSpectrumHoverLeave,
    // Spectrogram
    spectrogramSnapRef,
    frequencyMarkerRef,
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
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
            {(() => {
              // Auto mode: unknown channel count — user needs to pick a layout manually.
              if (
                channelLayout === "auto" &&
                layoutResolution.resolved === "unknown" &&
                channelCount > 0
              ) {
                return (
                  <>
                    <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
                    <span className="min-w-0 truncate text-muted-foreground">
                      {channelCount}-channel detected · Select layout in Settings
                    </span>
                  </>
                );
              }
              // Manual mode: selection doesn't match what auto would detect.
              const autoResolved = resolveChannelLayout("auto", { channelCount }).resolved;
              if (channelLayout !== "auto" && channelLayout !== autoResolved) {
                return (
                  <>
                    <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
                    <span className="min-w-0 truncate text-muted-foreground">
                      Device is {autoResolved === "unknown" ? `${channelCount}-ch` : autoResolved} ·
                      selected {channelLayout}
                    </span>
                  </>
                );
              }
              return null;
            })()}
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
          channelLayout={channelLayout}
          setChannelLayout={setChannelLayout}
          appVersion={APP_VERSION}
          latestVersion={updateInfo?.latestVersion}
          releaseUrl={updateInfo?.releaseUrl}
          hasUpdate={updateInfo?.hasUpdate}
          openReleaseUrl={openExternalUrl}
        />
      </div>
    </AudioDataContext.Provider>
  );
}
