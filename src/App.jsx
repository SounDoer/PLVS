import { useEffect, useMemo, useRef, useState } from "react";
import {
  peakFromTopFrac,
  PEAK_DB_MIN,
  PEAK_DB_MAX,
  loudnessHistY,
  LOUDNESS_TICKS,
} from "./scales";
import { UI_PREFERENCES } from "./uiPreferences";
import { buildHistoryPath, getHistoryViewport, HISTORY_MAX_WINDOW_SEC, HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { fmtMetric } from "./math/formatMath";
import { samplePeakLineColor } from "./math/colorMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useLayoutDrag } from "./hooks/useLayoutDrag";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useHoverState } from "./hooks/useHoverState";
import { useMeterHealth } from "./hooks/useMeterHealth";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import { PillButton } from "./components/PillButton";
import { SettingsPanel } from "./components/SettingsPanel";
import { isTauri } from "./ipc/env.js";
import { clearAudioHistory, listAudioDevices } from "./ipc/commands.js";
import { onDeviceListChanged } from "./ipc/events.js";
import {
  loadCaptureDeviceId,
  readCaptureDeviceIdFromLocalStorage,
  saveCaptureDeviceId,
} from "./ipc/capturePrefs.js";
import { TitleBarWindowControls } from "./components/TitleBarWindowControls";
import { MeterHealthBadge } from "./components/MeterHealthBadge";
import { PeakPanel } from "./components/panels/PeakPanel";
import { LoudnessPanel } from "./components/panels/LoudnessPanel";
import { SpectrumPanel } from "./components/panels/SpectrumPanel";
import { VectorscopePanel } from "./components/panels/VectorscopePanel";

const HIST_SAMPLE_SEC = 0.1;
const HIST_MAX_SAMPLES = 36000;
const HISTORY_TIME_TICK_STEPS = 4;
export default function App() {
  const buildVersionRaw = import.meta.env.VITE_APP_VERSION || "dev";
  const buildVersion = buildVersionRaw === "dev" ? "dev" : buildVersionRaw.slice(0, 7);
  const STORE_KEY = UI_PREFERENCES.layoutPersistKey;

  const { settingsOpen, setSettingsOpen, uiMode, setUiMode, standard, setStandard, uiModeRef } = useSettings();

  const [running, setRunning] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [captureDeviceId, setCaptureDeviceId] = useState(() => readCaptureDeviceIdFromLocalStorage());
  const [channelLayout, setChannelLayout] = useState("auto");
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [historyWindowSec, setHistoryWindowSec] = useState(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
  const [historyOffsetSec, setHistoryOffsetSec] = useState(0);
  const [historyHudUntilTs, setHistoryHudUntilTs] = useState(0);
  const [historyHudHold, setHistoryHudHold] = useState(false);
  const [status, setStatus] = useState("Ready - click Start to begin monitoring");
  const [status2, setStatus2] = useState("Device: Not connected");
  const [histCurves, setHistCurves] = useState({ m: false, st: true });
  const meterHealth = useMeterHealth();
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
  });
  const [spectrumPath, setSpectrumPath] = useState("");
  const [spectrumPeakPath, setSpectrumPeakPath] = useState("");
  const [vectorPath, setVectorPath] = useState("");
  const [mainLeft, setMainLeft] = useState(UI_PREFERENCES.layout.mainColumn.initialPx);
  const [leftTopRatio, setLeftTopRatio] = useState(UI_PREFERENCES.layout.leftSplit.initialRatio);
  const [rightTopRatio, setRightTopRatio] = useState(UI_PREFERENCES.layout.rightSplit.initialRatio);
  const [loudnessHistWidthRatio, setLoudnessHistWidthRatio] = useState(UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio);

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

  const historyTimeTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= HISTORY_TIME_TICK_STEPS; i++) {
      const sec = Math.round(historyOffsetSec + (historyWindowSec * (HISTORY_TIME_TICK_STEPS - i)) / HISTORY_TIME_TICK_STEPS);
      if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        ticks.push(`${m}m${s ? `${s}s` : ""}`);
      } else {
        ticks.push(`${sec}s`);
      }
    }
    return ticks;
  }, [historyOffsetSec, historyWindowSec]);

  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const renderPeakFill = (dbValue) => {
    if (!Number.isFinite(dbValue)) return null;
    const clamped = Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, dbValue));
    const clipTopPct = peakFromTopFrac(clamped) * 100;
    return (
      <div
        className="absolute inset-0 overflow-hidden rounded-md"
        style={{ clipPath: `inset(${clipTopPct}% 0 0 0 round 0.375rem)` }}
      >
        <div className="meter-gradient absolute inset-0" />
      </div>
    );
  };
  const meterGradientCfg = {
    ...UI_PREFERENCES.modules.peak.meterGradient,
    ...(UI_PREFERENCES.themes[uiMode === "light" ? "light" : "dark"]?.meterGradient || {}),
  };
  const getSamplePeakLineColor = (dbValue) =>
    samplePeakLineColor(
      dbValue,
      (v) => peakFromTopFrac(Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, v))),
      meterGradientCfg
    );
  const toggleCurve = (key) => setHistCurves((prev) => ({ ...prev, [key]: !prev[key] }));
  const targetLufs = standard === "ebu" ? -23 : -14;
  const historyYAxisTicks = useMemo(() => {
    const out = [...LOUDNESS_TICKS];
    if (!out.some((t) => t.v === targetLufs)) out.push({ v: targetLufs, lb: String(targetLufs) });
    out.sort((a, b) => b.v - a.v);
    return out;
  }, [targetLufs]);

  const psr = Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.shortTerm)
    ? displayAudio.tpMax - displayAudio.shortTerm
    : -Infinity;
  const plr = Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.integrated)
    ? displayAudio.tpMax - displayAudio.integrated
    : -Infinity;
  const primaryMetrics = [
    { label: "Momentary", value: fmtMetric(displayAudio.momentary), unit: "LUFS" },
    { label: "Short-term", value: fmtMetric(displayAudio.shortTerm), unit: "LUFS" },
    { label: "Integrated", value: fmtMetric(displayAudio.integrated), unit: "LUFS" },
    { label: "Momentary Max", value: fmtMetric(displayAudio.mMax), unit: "LUFS" },
    { label: "Short-term Max", value: fmtMetric(displayAudio.stMax), unit: "LUFS" },
    { label: "Loudness Range (LRA)", value: fmtMetric(displayAudio.lra), unit: "LU" },
  ];
  const secondaryMetrics = [
    { label: "Dynamics (PSR)", value: fmtMetric(psr), unit: "dB" },
    { label: "Avg. Dynamics (PLR)", value: fmtMetric(plr), unit: "dB" },
  ];

  const historyChartInteractive = running || hasHistoryData;
  const vsGridDiagInset = Math.max(0, Math.min(20, UI_PREFERENCES.modules.vector.charts.vectorscope.gridDiagInsetPct ?? 0));
  const vsGridDiagFar = 100 - vsGridDiagInset;
  const hasTpMaxValue = Number.isFinite(displayAudio.tpMax);
  const tpMaxText = hasTpMaxValue ? `${displayAudio.tpMax.toFixed(1)} dBTP` : "-";
  const startMode = selectedOffset >= 0 ? "live" : running ? "stop" : "start";
  const startLabel = startMode === "live" ? "LIVE" : startMode === "stop" ? "STOP" : "START";
  const channelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const layoutResolution = useMemo(
    () => resolveChannelLayout(channelLayout, { channelCount }),
    [channelLayout, channelCount]
  );
  const showLayoutUnknownMessage = layoutResolution.mode === "auto" && layoutResolution.resolved === "unknown" && channelCount > 2;

  const totalSamples = histSourceList.length;
  const { clampedWindowSec, visibleSamples, maxOffsetSamples, effectiveOffsetSamples, effectiveOffsetSec } = getHistoryViewport(
    totalSamples,
    historyWindowSec,
    historyOffsetSec,
    HIST_SAMPLE_SEC
  );
  const displayHistoryPathM = buildHistoryPath(
    histSourceList, "m", visibleSamples, effectiveOffsetSamples, (v) => loudnessHistY(v, 220)
  );
  const displayHistoryPathST = buildHistoryPath(
    histSourceList, "st", visibleSamples, effectiveOffsetSamples, (v) => loudnessHistY(v, 220)
  );
  const selectedHistSteps = selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / HIST_SAMPLE_SEC)) : -1;
  const showSelLine =
    selectedOffset >= 0 &&
    totalSamples > 0 &&
    selectedHistSteps >= 0 &&
    selectedHistSteps < totalSamples;
  const isHistoryHudVisible = historyChartInteractive && (historyHudHold || historyHudUntilTs > Date.now());
  const selLineX = Math.max(
    0,
    Math.min(
      600,
      600 - ((selectedHistSteps - effectiveOffsetSamples) / Math.max(1, visibleSamples - 1)) * 600
    )
  );

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
    setMainLeft,
    setLeftTopRatio,
    setRightTopRatio,
    setLoudnessHistWidthRatio,
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
      momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, mMax: -Infinity, stMax: -Infinity, lra: -Infinity,
      tpL: -Infinity, tpR: -Infinity, truePeakL: -Infinity, truePeakR: -Infinity,
      tpMax: -Infinity, samplePeakMaxL: -Infinity, samplePeakMaxR: -Infinity,
      sampleL: -Infinity, sampleR: -Infinity, samplePeak: -Infinity, correlation: -Infinity,
    });
    setSelectedOffset(-1);
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
    setStatus(running ? "Running - cleared history and peak hold" : "Ready - click Start to begin monitoring");
  };

  const resetLayout = () => {
    setMainLeft(UI_PREFERENCES.layout.mainColumn.initialPx);
    setLeftTopRatio(UI_PREFERENCES.layout.leftSplit.initialRatio);
    setRightTopRatio(UI_PREFERENCES.layout.rightSplit.initialRatio);
    setLoudnessHistWidthRatio(UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio);
  };

  const onStartClick = () => {
    if (selectedOffset >= 0) return void (setSelectedOffset(-1), setStatus("Monitoring live input"));
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
    if (historyHudHold) return;
    const remain = historyHudUntilTs - Date.now();
    if (remain <= 0) return;
    const t = setTimeout(() => setHistoryHudUntilTs(0), remain + 24);
    return () => clearTimeout(t);
  }, [historyHudUntilTs, historyHudHold]);

  useEffect(() => {
    if (historyChartInteractive) return;
    setHistoryHudHold(false);
    setHistoryHudUntilTs(0);
  }, [historyChartInteractive]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.mainLeft === "number") setMainLeft(s.mainLeft);
      if (typeof s.leftTopRatio === "number") setLeftTopRatio(s.leftTopRatio);
      if (typeof s.rightTopRatio === "number") setRightTopRatio(s.rightTopRatio);
      if (typeof s.loudnessHistWidthRatio === "number") setLoudnessHistWidthRatio(s.loudnessHistWidthRatio);
      if (s.channelLayout === "auto" || s.channelLayout === "stereo" || s.channelLayout === "5.1") setChannelLayout(s.channelLayout);
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ mainLeft, leftTopRatio, rightTopRatio, loudnessHistWidthRatio, standard, uiMode, channelLayout })
      );
    } catch (_) {}
  }, [mainLeft, leftTopRatio, rightTopRatio, loudnessHistWidthRatio, standard, uiMode, channelLayout]);

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listAudioDevices();
        if (!cancelled) setAudioDevices(Array.isArray(list) ? list : []);
      } catch (_) {
        if (!cancelled) setAudioDevices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void loadCaptureDeviceId().then((id) => {
      if (!cancelled) setCaptureDeviceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten = () => {};
    (async () => {
      const u = await onDeviceListChanged((list) => {
        if (!disposed) setAudioDevices(Array.isArray(list) ? list : []);
      });
      if (!disposed) unlisten = u;
      else u();
    })();
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (!audioDevices.length) return;
    if (captureDeviceId === "default") return;
    if (!audioDevices.some((d) => d.id === captureDeviceId)) {
      setCaptureDeviceId("default");
      void saveCaptureDeviceId("default");
    }
  }, [audioDevices, captureDeviceId]);

  /** Matches Loudness History snapshot mode: meters/spectrum/vector read the selected instant, not live input */
  useEffect(() => {
    if (!running || selectedOffset < 0) return;
    setStatus("History snapshot (not live input)");
  }, [running, selectedOffset]);

  useAudioEngine({
    running,
    captureDeviceId,
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
    uiModeRef,
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
    <div className="ui-page">
      <div className="ui-shell-inner">
        <header className="ui-header" {...(isTauri() ? { "data-tauri-drag-region": "" } : {})}>
          <div className="ui-app-title">
            Audio<span className="ui-app-title-brand">Meter</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3 pr-2">
            {isTauri() && (
              <div className="flex min-w-0 max-w-[min(22rem,42vw)] items-center gap-2" data-tauri-no-drag="">
                <label htmlFor="capture-device-select" className="shrink-0 text-[length:var(--ui-fs-metric-meta)] text-[color:var(--ui-color-muted)]">
                  Device
                </label>
                <select
                  id="capture-device-select"
                  className="ui-select min-w-0 flex-1 text-[length:var(--ui-fs-metric-meta)]"
                  value={captureDeviceId}
                  disabled={!audioDevices.length}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCaptureDeviceId(v);
                    void saveCaptureDeviceId(v);
                  }}
                >
                  <option value="default">Automatic (default system output)</option>
                  {audioDevices.some((d) => d.isSystemOutputMonitor) ? (
                    <optgroup label="Output">
                      {audioDevices
                        .filter((d) => d.isSystemOutputMonitor)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {audioDevices.some((d) => !d.isSystemOutputMonitor) ? (
                    <optgroup label="Input">
                      {audioDevices
                        .filter((d) => !d.isSystemOutputMonitor)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-[var(--ui-header-action-gap)]" {...(isTauri() ? { "data-tauri-no-drag": "" } : {})}>
            <PillButton onClick={clearAll}>Clear</PillButton>
            <PillButton accent liveSnap={startMode === "live"} onClick={onStartClick}>
              {startLabel}
            </PillButton>
            <PillButton onClick={() => setSettingsOpen(true)}>Settings</PillButton>
            {isTauri() ? <TitleBarWindowControls /> : null}
          </div>
        </header>

        <main
          className="min-h-0 flex-1 gap-[var(--ui-section-gap)] overflow-y-auto lg:grid lg:gap-0 lg:overflow-hidden lg:min-h-0 lg:grid-cols-[var(--left)_var(--ui-splitter-main)_1fr] lg:grid-rows-[minmax(0,1fr)]"
          style={{ "--left": `${mainLeft}px` }}
        >
          <section
            className="grid min-h-0 gap-[var(--ui-section-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--leftTop)_var(--ui-splitter-row)_minmax(0,1fr)]"
            style={{ "--leftTop": `${Math.round(leftTopRatio * 100)}%` }}
          >
            <PeakPanel
              displayAudio={displayAudio}
              renderPeakFill={renderPeakFill}
              getSamplePeakLineColor={getSamplePeakLineColor}
              fmt={fmt}
              hasTpMaxValue={hasTpMaxValue}
              tpMaxText={tpMaxText}
            />

            <div
              className="ui-splitter-v"
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
            />
          </section>

          <div
            className="ui-splitter-h"
            onPointerDown={(e) => beginLayoutDrag("main", e)}
            onPointerMove={onLayoutDragMove}
            onPointerUp={onLayoutDragUp}
            onPointerCancel={onLayoutDragUp}
          />

          <section
            className="grid min-h-0 gap-[var(--ui-section-gap)] lg:h-full lg:min-h-0 lg:gap-0 lg:grid-rows-[var(--rightTop)_var(--ui-splitter-row)_minmax(0,1fr)]"
            style={{ "--rightTop": `${Math.round(rightTopRatio * 100)}%` }}
          >
            <LoudnessPanel
              loudnessHistWidthRatio={loudnessHistWidthRatio}
              historyYAxisTicks={historyYAxisTicks}
              targetLufs={targetLufs}
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
              className="ui-splitter-v"
              onPointerDown={(e) => beginLayoutDrag("right", e)}
              onPointerMove={onLayoutDragMove}
              onPointerUp={onLayoutDragUp}
              onPointerCancel={onLayoutDragUp}
            />

            <SpectrumPanel
              displaySpectrumPath={displaySpectrumPath}
              displaySpectrumPeakPath={displaySpectrumPeakPath}
              selectedOffset={selectedOffset}
              spectrumHover={spectrumHover}
              onSpectrumHoverMove={onSpectrumHoverMove}
              onSpectrumHoverLeave={onSpectrumHoverLeave}
            />
          </section>
        </main>

        <footer className="ui-footer">
          <span>{status}</span>
          <span className="h-3 w-px bg-[color:var(--ui-color-divider)]" />
          <span>{status2}</span>
          {showLayoutUnknownMessage ? (
            <>
              <span className="h-3 w-px bg-[color:var(--ui-color-divider)]" />
              <span
                className="text-[color:var(--ui-color-text-muted)]"
                title="Auto channel layout detection is not available yet. Select a preset in Settings → Channel layout (Advanced)."
              >
                Multi-channel detected. Layout unknown (Auto) — select a preset in Settings.
              </span>
            </>
          ) : null}
          <span className="h-3 w-px bg-[color:var(--ui-color-divider)]" />
          <MeterHealthBadge health={meterHealth} />
          <span className="h-3 w-px bg-[color:var(--ui-color-divider)]" />
          <span>Loudness standard: {standard === "ebu" ? "EBU R128" : "Streaming"}</span>
          <span className="h-3 w-px bg-[color:var(--ui-color-divider)]" />
          <span>Build: {buildVersion}</span>
        </footer>
      </div>

      <SettingsPanel
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        uiMode={uiMode}
        setUiMode={setUiMode}
        standard={standard}
        setStandard={setStandard}
        channelLayout={channelLayout}
        setChannelLayout={setChannelLayout}
        resetLayout={resetLayout}
      />
    </div>
  );
}
