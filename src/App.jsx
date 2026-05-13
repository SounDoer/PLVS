import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { UI_PREFERENCES, readPersistedVectorscopePair } from "./uiPreferences";
import {
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_MIN_WINDOW_SEC,
  HISTORY_TIME_TICK_STEPS,
} from "./math/historyMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./hooks/useLoudnessHistory.js";
import { useLayoutDrag } from "./hooks/useLayoutDrag";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useHoverState } from "./hooks/useHoverState";
import { useMeterHealth } from "./hooks/useMeterHealth";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import { buildMeteringFootnoteHints } from "./math/meteringFootnoteHints.js";
import {
  buildVectorscopePairOptions,
  clampVectorscopePairToAvailable,
} from "./math/vectorscopePairMath.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { LOUDNESS_REFERENCE_PROFILES } from "./config/loudnessReferenceProfiles.js";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CaptureDeviceSelect } from "./components/CaptureDeviceSelect";
import { SettingsPanel } from "./components/SettingsPanel";
import { cn } from "@/lib/utils";
import {
  APP_TITLE,
  APP_TITLE_BRAND,
  SHELL_FOOTER,
  SHELL_HEADER,
  SHELL_INNER,
  SHELL_PAGE,
} from "@/lib/shellLayout";
import { Play, Radio, Settings, Square, Trash2 } from "lucide-react";
import { isTauri } from "./ipc/env.js";
import { clearAudioHistory, setVectorscopePair } from "./ipc/commands.js";
import { MeterHealthBadge } from "./components/MeterHealthBadge";
import { PeakPanel } from "./components/panels/PeakPanel";
import { LoudnessPanel } from "./components/panels/LoudnessPanel";
import { SpectrumPanel } from "./components/panels/SpectrumPanel";
import { SpectrogramPanel } from "./components/panels/SpectrogramPanel";
import { VectorscopePanel } from "./components/panels/VectorscopePanel";

const HIST_MAX_SAMPLES = 36000;

const buildVersionRaw = import.meta.env.VITE_APP_VERSION || "dev";
const buildVersion = buildVersionRaw === "dev" ? "dev" : buildVersionRaw.slice(0, 7);
const STORE_KEY = UI_PREFERENCES.layoutPersistKey;

/** Horizontal layout rails (column resize): subtle cyan-tinted hover glow using injected `--ui-*` tokens */
const RESIZE_COL_CLASS =
  "hidden w-[var(--ui-splitter-bar-thickness)] cursor-col-resize justify-self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";

/** Vertical layout rails (row resize) */
const RESIZE_ROW_CLASS =
  "hidden h-[var(--ui-splitter-bar-thickness)] cursor-row-resize self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";
export default function App() {
  const {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearanceMode,
    fixedThemeSelectValue,
    setFixedThemeIdFromPicker,
    themeSelectOptions,
    resolvedThemeId,
    referenceProfileId,
    setReferenceProfileId,
  } = useSettings();

  const { audioDevices, captureDeviceId, setCaptureDeviceIdAndPersist, defaultOutputFormatSig } =
    useAudioDevices();

  const [running, setRunning] = useState(false);
  const [channelLayout, setChannelLayout] = useState("auto");
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [status, setStatus] = useState("Ready - click Start to begin monitoring");
  const [status2, setStatus2] = useState("Device: Not connected");
  const meterHealth = useMeterHealth();
  const [vectorscopePairUi, setVectorscopePairUi] = useState(() => readPersistedVectorscopePair());
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

  const audioRef = useRef(null);
  const spectrumStateRef = useRef({ smoothDb: [], peakDb: [], peakHoldUntil: [] });
  const spectrumTimeRef = useRef(0);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const histRef = useRef([]);
  const loudnessHistRef = useRef([]);
  const spectrumSnapRef = useRef([]);
  const spectrumDataRef = useRef(null);
  const spectrumDataSnapRef = useRef([]);
  const vectorSnapRef = useRef([]);
  const corrSnapRef = useRef([]);
  const audioSnapRef = useRef([]);
  const selectedOffsetRef = useRef(-1);
  const vectorscopePairRef = useRef(readPersistedVectorscopePair());

  const {
    histSourceList,
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    correlation,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    loudnessHistRef,
    spectrumSnapRef,
    spectrumDataRef,
    spectrumDataSnapRef,
    vectorSnapRef,
    corrSnapRef,
    audioSnapRef,
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
    histCurves,
    toggleCurve,
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
    referenceProfile,
    targetLufs,
    historyYAxisTicks,
    primaryMetrics,
    secondaryMetrics,
  } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceProfileId,
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
  const startLabel = startMode === "live" ? "LIVE" : startMode === "stop" ? "STOP" : "START";
  const channelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const layoutResolution = useMemo(
    () => resolveChannelLayout(channelLayout, { channelCount }),
    [channelLayout, channelCount]
  );
  const meteringFootnotes = useMemo(
    () => buildMeteringFootnoteHints({ running, channelLayout, channelCount }),
    [running, channelLayout, channelCount]
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

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (captureDeviceId === "default") {
      return defaultOutputFormatSig || "";
    }
    const d = audioDevices.find((x) => x.id === captureDeviceId);
    return d ? `${d.channels}:${d.defaultSampleRate}` : "";
  }, [captureDeviceId, audioDevices, defaultOutputFormatSig]);

  useEffect(() => {
    if (!running) return;
    const x = Number.isFinite(displayAudio?.vectorscopePairX)
      ? Number(displayAudio.vectorscopePairX)
      : 0;
    const y = Number.isFinite(displayAudio?.vectorscopePairY)
      ? Number(displayAudio.vectorscopePairY)
      : 1;
    setVectorscopePairUi({ x, y });
  }, [running, displayAudio?.vectorscopePairX, displayAudio?.vectorscopePairY]);

  useEffect(() => {
    const next = clampVectorscopePairToAvailable(
      vectorscopePairUi,
      channelCount,
      vectorscopeLabelContext
    );
    if (next.x === vectorscopePairUi.x && next.y === vectorscopePairUi.y) return;
    setVectorscopePairUi(next);
    if (isTauri() && running) void setVectorscopePair({ x: next.x, y: next.y });
  }, [channelCount, vectorscopeLabelContext, vectorscopePairUi.x, vectorscopePairUi.y, running]);

  const onVectorscopePairChange = async (pair) => {
    setVectorscopePairUi(pair);
    if (!isTauri()) return;
    try {
      await setVectorscopePair({ x: pair.x, y: pair.y });
    } catch (_) {}
  };

  useEffect(() => {
    vectorscopePairRef.current = vectorscopePairUi;
  }, [vectorscopePairUi]);

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
    histRef.current = [];
    loudnessHistRef.current = [];
    spectrumSnapRef.current = [];
    spectrumDataRef.current = null;
    spectrumDataSnapRef.current = [];
    vectorSnapRef.current = [];
    corrSnapRef.current = [];
    audioSnapRef.current = [];
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
  };

  const resetLayout = () => {
    setMainLeft(UI_PREFERENCES.layout.mainColumn.initialPx);
    setLeftTopRatio(UI_PREFERENCES.layout.leftSplit.initialRatio);
    setRightTopRatio(UI_PREFERENCES.layout.rightSplit.initialRatio);
    setLoudnessHistWidthRatio(UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio);
  };

  const onStartClick = () => {
    if (selectedOffset >= 0)
      return void (setSelectedOffset(-1), setStatus("Monitoring live input"));
    if (running) {
      setRunning(false);
      setSelectedOffset(-1);
      setStatus("Stopped - click Start to resume");
      setStatus2("Device: Not connected");
      return;
    }
    setRunning(true);
  };

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
      if (s.channelLayout === "auto" || s.channelLayout === "stereo" || s.channelLayout === "5.1")
        setChannelLayout(s.channelLayout);
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      let prev = {};
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) prev = JSON.parse(raw);
      const persistedThemeId = appearance === "system" ? null : fixedThemeSelectValue;
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          ...prev,
          mainLeft,
          leftTopRatio,
          rightTopRatio,
          loudnessHistWidthRatio,
          spectrogramTopRatio,
          referenceProfileId,
          appearance,
          themeId: persistedThemeId,
          channelLayout,
          vectorscopePairX: vectorscopePairUi.x,
          vectorscopePairY: vectorscopePairUi.y,
        })
      );
    } catch (_) {}
  }, [
    mainLeft,
    leftTopRatio,
    rightTopRatio,
    loudnessHistWidthRatio,
    spectrogramTopRatio,
    referenceProfileId,
    appearance,
    fixedThemeSelectValue,
    channelLayout,
    vectorscopePairUi,
  ]);

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

  /** Matches Loudness History snapshot mode: meters/spectrum/vector read the selected instant, not live input */
  useEffect(() => {
    if (!running || selectedOffset < 0) return;
    setStatus("History snapshot (not live input)");
  }, [running, selectedOffset]);

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
    histRef,
    loudnessHistRef,
    spectrumSnapRef,
    spectrumDataRef,
    spectrumDataSnapRef,
    vectorSnapRef,
    corrSnapRef,
    audioSnapRef,
    selectedOffsetRef,
    vectorscopePairRef,
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

  return (
    <div className={SHELL_PAGE}>
      <div className={SHELL_INNER}>
        <header className={SHELL_HEADER}>
          <div className={APP_TITLE}>
            Audio<span className={APP_TITLE_BRAND}>Meter</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3 pr-2">
            {isTauri() && (
              <CaptureDeviceSelect
                audioDevices={audioDevices}
                value={captureDeviceId}
                disabled={!audioDevices.length}
                onValueChange={(v) => setCaptureDeviceIdAndPersist(v)}
              />
            )}
          </div>
          <div className="flex items-center gap-[var(--ui-header-action-gap)]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAll}
              className="gap-2 font-semibold"
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              Clear
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onStartClick}
              className={cn(
                "min-w-[5.75rem] gap-2 font-semibold",
                startMode === "live" &&
                  "live-snap-pulse !bg-[var(--ui-chart-vectorscope-snap)] !text-white shadow-none hover:!brightness-[0.94]"
              )}
            >
              {startMode === "live" ? (
                <Radio className="size-4 shrink-0" aria-hidden />
              ) : startMode === "stop" ? (
                <Square className="size-4 shrink-0" aria-hidden />
              ) : (
                <Play className="size-4 shrink-0" aria-hidden />
              )}
              {startLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className="gap-2 font-semibold"
            >
              <Settings className="size-4 shrink-0" aria-hidden />
              Settings
            </Button>
          </div>
        </header>

        <main
          className="min-h-0 flex-1 gap-[var(--ui-panel-gap)] overflow-y-auto lg:flex lg:flex-col lg:gap-0 lg:overflow-hidden lg:min-h-0"
        >
          <div
            className="lg:grid lg:min-h-0 lg:gap-0 lg:grid-cols-[var(--left)_var(--ui-panel-gap)_1fr] lg:grid-rows-[minmax(0,1fr)]"
            style={{ "--left": `${mainLeft}px`, height: `${Math.round(spectrogramTopRatio * 100)}%` }}
          >
          <section
            className="grid min-h-0 gap-[var(--ui-panel-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--leftTop)_var(--ui-panel-gap)_minmax(0,1fr)]"
            style={{ "--leftTop": `${Math.round(leftTopRatio * 100)}%` }}
          >
            <PeakPanel
              displayAudio={displayAudio}
              peakLabelContext={{
                channelLayout,
                resolvedLayout: layoutResolution.resolved,
              }}
              getSamplePeakLineColor={getSamplePeakLineColor}
              fmt={fmt}
              hasTpMaxValue={hasTpMaxValue}
              tpMaxText={tpMaxText}
            />

            <div
              className={RESIZE_ROW_CLASS}
              onPointerDown={(e) => beginLayoutDrag("left", e)}
              onPointerMove={onLayoutDragMove}
              onPointerUp={onLayoutDragUp}
              onPointerCancel={onLayoutDragUp}
            />

            <VectorscopePanel
              vsGridDiagInset={vsGridDiagInset}
              vsGridDiagFar={vsGridDiagFar}
              displayVectorPath={displayVectorPath}
              selectedOffset={selectedOffset}
              correlation={correlation}
              channelCount={channelCount}
              peakLabelContext={{
                channelLayout,
                resolvedLayout: layoutResolution.resolved,
              }}
              pairX={vectorscopePairUi.x}
              pairY={vectorscopePairUi.y}
            />
          </section>

          <div
            className={RESIZE_COL_CLASS}
            onPointerDown={(e) => beginLayoutDrag("main", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <section
            className="grid min-h-0 gap-[var(--ui-panel-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--rightTop)_var(--ui-panel-gap)_minmax(0,1fr)]"
            style={{ "--rightTop": `${Math.round(rightTopRatio * 100)}%` }}
          >
            <LoudnessPanel
              loudnessHistWidthRatio={loudnessHistWidthRatio}
              historyYAxisTicks={historyYAxisTicks}
              targetLufs={targetLufs}
              referenceProfile={referenceProfile}
              hasHistoryData={hasHistoryData}
              historyChartInteractive={historyChartInteractive}
              running={running}
              setSelectedOffset={setSelectedOffset}
              setStatus={setStatus}
              holdHistoryHud={holdHistoryHud}
              showHistoryHud={showHistoryHud}
              onHistoryWheel={onHistoryWheel}
              onHistoryPointerDown={onHistoryPointerDown}
              onHistoryPointerMove={onHistoryPointerMove}
              onHistoryPointerUp={onHistoryPointerUp}
              histCurves={histCurves}
              displayHistoryPathM={displayHistoryPathM}
              displayHistoryPathST={displayHistoryPathST}
              selectedOffset={selectedOffset}
              showSelLine={showSelLine}
              selLineX={selLineX}
              isHistoryHudVisible={isHistoryHudVisible}
              clampedWindowSec={clampedWindowSec}
              effectiveOffsetSec={effectiveOffsetSec}
              historyHover={historyHover}
              historyTimeTicks={historyTimeTicks}
              historyTickSteps={HISTORY_TIME_TICK_STEPS}
              primaryMetrics={primaryMetrics}
              secondaryMetrics={secondaryMetrics}
              toggleCurve={toggleCurve}
              onHistoryHoverMove={onHistoryHoverMove}
              onHistoryHoverLeave={onHistoryHoverLeave}
            />

            <div
              className={RESIZE_ROW_CLASS}
              onPointerDown={(e) => beginLayoutDrag("right", e)}
              onPointerMove={onLayoutDragMove}
              onPointerUp={onLayoutDragUp}
              onPointerCancel={onLayoutDragUp}
            />

            <SpectrumPanel
              displaySpectrumPath={displaySpectrumPath}
              displaySpectrumPeakPath={displaySpectrumPeakPath}
              channelCount={Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb.length : 0}
              selectedOffset={selectedOffset}
              spectrumHover={spectrumHover}
              onSpectrumHoverMove={onSpectrumHoverMove}
              onSpectrumHoverLeave={onSpectrumHoverLeave}
            />
          </section>
          </div>

          <div
            className={RESIZE_ROW_CLASS}
            onPointerDown={(e) => beginLayoutDrag("spectrogram", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <SpectrogramPanel
            snapRef={spectrumDataSnapRef}
            effectiveOffsetSamples={effectiveOffsetSamples}
            visibleSamples={visibleSamples}
            selectedOffset={selectedOffset}
            setSelectedOffset={setSelectedOffset}
            totalSamples={totalSamples}
          />
        </main>

        <footer className={SHELL_FOOTER}>
          <span>{status}</span>
          <Separator orientation="vertical" className="h-3 shrink-0" decorative />
          <span>{status2}</span>
          {meteringFootnotes.map((hint) => (
            <Fragment key={hint.id}>
              <Separator orientation="vertical" className="h-3 shrink-0" decorative />
              <span className="text-muted-foreground" title={hint.title}>
                {hint.message}
              </span>
            </Fragment>
          ))}
          <Separator orientation="vertical" className="h-3 shrink-0" decorative />
          <MeterHealthBadge health={meterHealth} />
          <Separator orientation="vertical" className="h-3 shrink-0" decorative />
          <span>Ref: {referenceProfile.label}</span>
          <Separator orientation="vertical" className="h-3 shrink-0" decorative />
          <span>Build: {buildVersion}</span>
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
        referenceProfileId={referenceProfileId}
        setReferenceProfileId={setReferenceProfileId}
        loudnessReferenceProfiles={LOUDNESS_REFERENCE_PROFILES}
        channelLayout={channelLayout}
        setChannelLayout={setChannelLayout}
        vectorscopePairOptions={vectorscopePairOptions}
        vectorscopePairX={vectorscopePairUi.x}
        vectorscopePairY={vectorscopePairUi.y}
        onVectorscopePairChange={onVectorscopePairChange}
        resetLayout={resetLayout}
      />
    </div>
  );
}
