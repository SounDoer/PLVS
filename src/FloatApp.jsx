import { useEffect, useMemo, useState } from "react";
import { buildHistoryPath, getHistoryViewport, HISTORY_MAX_WINDOW_SEC, HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { fmtMetric } from "./math/formatMath";
import { isTauri } from "./ipc/env.js";
import { peakFromTopFrac, LOUDNESS_TICKS, loudnessHistY, PEAK_DB_MAX, PEAK_DB_MIN } from "./scales";
import { UI_PREFERENCES } from "./uiPreferences";
import { samplePeakLineColor } from "./math/colorMath";
import { useFloatMeteringCore } from "./hooks/useFloatMeteringCore";
import { useFloatWindowPersistence } from "./hooks/useFloatWindowPersistence";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useHoverState } from "./hooks/useHoverState";
import { PeakPanel } from "./components/panels/PeakPanel";
import { LoudnessPanel } from "./components/panels/LoudnessPanel";
import { SpectrumPanel } from "./components/panels/SpectrumPanel";
import { VectorscopePanel } from "./components/panels/VectorscopePanel";
import { getLoudnessReferenceProfileById } from "./loudnessReferenceProfiles.js";

const HISTORY_TIME_TICK_STEPS = 4;
const PANELS = new Set(["peak", "loudness", "spectrum", "vector"]);

function useSharedPeakVis(uiMode, displayAudio) {
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
  const hasTpMaxValue = Number.isFinite(displayAudio.tpMax);
  const tpMaxText = hasTpMaxValue ? `${displayAudio.tpMax.toFixed(1)} dBTP` : "-";
  return { fmt, renderPeakFill, getSamplePeakLineColor, hasTpMaxValue, tpMaxText };
}

function FloatLoudnessBody({ core }) {
  const {
    engineRunning,
    standard,
    referenceProfileId,
    HIST_SAMPLE_SEC,
    selectedOffset,
    setSelectedOffset,
    displayAudio,
    displaySpectrumData,
    hasHistoryData,
    histSourceList,
  } = core;
  const [historyWindowSec, setHistoryWindowSec] = useState(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
  const [historyOffsetSec, setHistoryOffsetSec] = useState(0);
  const [historyHudUntilTs, setHistoryHudUntilTs] = useState(0);
  const [historyHudHold, setHistoryHudHold] = useState(false);
  const [histCurves, setHistCurves] = useState({ m: false, st: true });
  const loudnessHistWidthRatio = UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio;
  const targetLufs = standard === "ebu" ? -23 : -14;
  const referenceProfile = useMemo(() => getLoudnessReferenceProfileById(referenceProfileId), [referenceProfileId]);
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
  const primaryMetrics = useMemo(
    () => [
      { label: "Momentary", value: fmtMetric(displayAudio.momentary), unit: "LUFS" },
      { label: "Short-term", value: fmtMetric(displayAudio.shortTerm), unit: "LUFS" },
      { label: "Integrated", value: fmtMetric(displayAudio.integrated), unit: "LUFS" },
      { label: "Momentary Max", value: fmtMetric(displayAudio.mMax), unit: "LUFS" },
      { label: "Short-term Max", value: fmtMetric(displayAudio.stMax), unit: "LUFS" },
      { label: "Loudness Range (LRA)", value: fmtMetric(displayAudio.lra), unit: "LU" },
    ],
    [displayAudio]
  );
  const secondaryMetrics = useMemo(
    () => [
      { label: "Dynamics (PSR)", value: fmtMetric(psr), unit: "dB" },
      { label: "Avg. Dynamics (PLR)", value: fmtMetric(plr), unit: "dB" },
    ],
    [plr, psr]
  );
  const historyChartInteractive = engineRunning || hasHistoryData;
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
    selectedOffset >= 0 && totalSamples > 0 && selectedHistSteps >= 0 && selectedHistSteps < totalSamples;
  const isHistoryHudVisible = historyChartInteractive && (historyHudHold || historyHudUntilTs > Date.now());
  const selLineX = Math.max(
    0,
    Math.min(
      600,
      600 - ((selectedHistSteps - effectiveOffsetSamples) / Math.max(1, visibleSamples - 1)) * 600
    )
  );
  const { historyTimeTicks, historyTickSteps } = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= HISTORY_TIME_TICK_STEPS; i++) {
      const sec = Math.round(
        historyOffsetSec + (clampedWindowSec * (HISTORY_TIME_TICK_STEPS - i)) / HISTORY_TIME_TICK_STEPS
      );
      if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        ticks.push(`${m}m${s ? `${s}s` : ""}`);
      } else {
        ticks.push(`${sec}s`);
      }
    }
    return { historyTimeTicks: ticks, historyTickSteps: HISTORY_TIME_TICK_STEPS };
  }, [clampedWindowSec, historyOffsetSec]);
  const {
    historyHover,
    spectrumHover,
    onHistoryHoverMove,
    onHistoryHoverLeave,
    onSpectrumHoverMove,
    onSpectrumHoverLeave,
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
  useEffect(() => {
    if (historyHudHold) return;
    const remain = historyHudUntilTs - Date.now();
    if (remain <= 0) return;
    const t = setTimeout(() => setHistoryHudUntilTs(0), remain + 24);
    return () => clearTimeout(t);
  }, [historyHudUntilTs, historyHudHold]);
  const setStatus = () => {};
  const toggleCurve = (key) => setHistCurves((prev) => ({ ...prev, [key]: !prev[key] }));
  return (
    <LoudnessPanel
      loudnessHistWidthRatio={loudnessHistWidthRatio}
      historyYAxisTicks={historyYAxisTicks}
      targetLufs={targetLufs}
      referenceProfile={referenceProfile}
      hasHistoryData={hasHistoryData}
      historyChartInteractive={historyChartInteractive}
      running={engineRunning}
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
      historyTickSteps={historyTickSteps}
      primaryMetrics={primaryMetrics}
      secondaryMetrics={secondaryMetrics}
      toggleCurve={toggleCurve}
      onHistoryHoverMove={onHistoryHoverMove}
      onHistoryHoverLeave={onHistoryHoverLeave}
    />
  );
}

function FloatPeakView({ core, uiMode }) {
  const v = useSharedPeakVis(uiMode, core.displayAudio);
  return (
    <div className="p-2">
      <PeakPanel
        displayAudio={core.displayAudio}
        renderPeakFill={v.renderPeakFill}
        getSamplePeakLineColor={v.getSamplePeakLineColor}
        fmt={v.fmt}
        hasTpMaxValue={v.hasTpMaxValue}
        tpMaxText={v.tpMaxText}
      />
    </div>
  );
}

function FloatSpectrumView({ core }) {
  const { spectrumHover, onSpectrumHoverMove, onSpectrumHoverLeave } = useHoverState({
    historyChartInteractive: false,
    histSourceList: [],
    effectiveOffsetSamples: 0,
    visibleSamples: 1,
    sampleSec: 0.1,
    displaySpectrumData: core.displaySpectrumData,
  });
  return (
    <div className="p-2">
      <SpectrumPanel
        displaySpectrumPath={core.displaySpectrumPath}
        displaySpectrumPeakPath={core.displaySpectrumPeakPath}
        channelCount={Array.isArray(core.displayAudio?.peakDb) ? core.displayAudio.peakDb.length : 0}
        selectedOffset={core.selectedOffset}
        spectrumHover={spectrumHover}
        onSpectrumHoverMove={onSpectrumHoverMove}
        onSpectrumHoverLeave={onSpectrumHoverLeave}
      />
    </div>
  );
}

function FloatVectorView({ core }) {
  const vsGridDiagInset = Math.max(0, Math.min(20, UI_PREFERENCES.modules.vector.charts.vectorscope.gridDiagInsetPct ?? 0));
  const vsGridDiagFar = 100 - vsGridDiagInset;
  return (
    <div className="p-2">
      <VectorscopePanel
        vsGridDiagInset={vsGridDiagInset}
        vsGridDiagFar={vsGridDiagFar}
        displayVectorPath={core.displayVectorPath}
        selectedOffset={core.selectedOffset}
        correlation={core.correlation}
        channelCount={Array.isArray(core.displayAudio?.peakDb) ? core.displayAudio.peakDb.length : 0}
        pairX={core.displayAudio?.vectorscopePairX}
        pairY={core.displayAudio?.vectorscopePairY}
      />
    </div>
  );
}

/**
 * @param {{ kind: string }} props
 */
export function FloatApp({ kind }) {
  useFloatWindowPersistence(kind);
  const core = useFloatMeteringCore(kind);
  const { uiMode } = core;
  if (!PANELS.has(kind)) {
    return (
      <div className="ui-page p-4 text-sm text-[color:var(--ui-color-muted)]">
        Unknown float panel. Use <code className="rounded bg-[var(--ui-color-inset-bg)] px-1">?float=peak|loudness|spectrum|vector</code>
      </div>
    );
  }
  if (!isTauri()) {
    return (
      <div className="ui-page p-4 text-sm text-[color:var(--ui-color-muted)]">
        Float panels are for the Tauri desktop build only. Run <code className="rounded bg-[var(--ui-color-inset-bg)] px-1">npm run desktop</code>
      </div>
    );
  }
  return (
    <div className="ui-page min-h-0">
      <div className="ui-shell-inner flex min-h-0 min-w-0 flex-1 flex-col">
        {!core.engineRunning ? (
          <main className="min-h-0 flex-1 p-3 text-sm text-[color:var(--ui-color-muted)]">
            The main window is not running the audio engine. Open AudioMeter, choose an input, and press <strong>START</strong> — this window
            will mirror the same data.
          </main>
        ) : kind === "loudness" ? (
          <main key={core.historyViewEpoch} className="min-h-0 min-w-0 flex-1 overflow-auto p-1">
            <FloatLoudnessBody core={core} />
          </main>
        ) : (
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            {kind === "peak" && <FloatPeakView core={core} uiMode={uiMode} />}
            {kind === "spectrum" && <FloatSpectrumView core={core} />}
            {kind === "vector" && <FloatVectorView core={core} />}
          </main>
        )}
      </div>
    </div>
  );
}

/**
 * @returns {string | null}
 */
export function getFloatParamFromUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("float");
}
