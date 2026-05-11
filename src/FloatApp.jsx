import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  buildHistoryPath,
  buildHistoryTimeAxisLabels,
  getHistoryViewport,
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_MIN_WINDOW_SEC,
  HISTORY_TIME_TICK_STEPS,
} from "./math/historyMath";
import { fmtMetric } from "./math/formatMath";
import { isTauri } from "./ipc/env.js";
import { LOUDNESS_TICKS, loudnessHistY } from "./scales";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { usePeakVis } from "./hooks/usePeakVis.js";
import { useFloatMeteringCore } from "./hooks/useFloatMeteringCore";
import { usePersistedChannelLayout } from "./hooks/usePersistedChannelLayout.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import { useFloatWindowPersistence } from "./hooks/useFloatWindowPersistence";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import { useHoverState } from "./hooks/useHoverState";
import { Card, CardContent } from "@/components/ui/card";
import { PeakPanel } from "./components/panels/PeakPanel";
import { LoudnessPanel } from "./components/panels/LoudnessPanel";
import { SpectrumPanel } from "./components/panels/SpectrumPanel";
import { VectorscopePanel } from "./components/panels/VectorscopePanel";
import { getLoudnessReferenceProfileById } from "./loudnessReferenceProfiles.js";
import { cn } from "@/lib/utils";
import { SHELL_INNER, SHELL_PAGE } from "@/lib/shellLayout";

const PANELS = new Set(["peak", "loudness", "spectrum", "vector"]);

function FloatLoudnessBody({ core }) {
  const {
    engineRunning,
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
  const referenceProfile = useMemo(() => getLoudnessReferenceProfileById(referenceProfileId), [referenceProfileId]);
  const targetLufs = Number.isFinite(referenceProfile?.targetLufs) ? referenceProfile.targetLufs : -23;
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
  const { historyTimeTicks, historyTickSteps } = useMemo(
    () => ({
      historyTimeTicks: buildHistoryTimeAxisLabels(historyOffsetSec, clampedWindowSec),
      historyTickSteps: HISTORY_TIME_TICK_STEPS,
    }),
    [clampedWindowSec, historyOffsetSec]
  );
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

function FloatPeakView({ core, resolvedThemeId }) {
  const v = usePeakVis(resolvedThemeId, core.displayAudio);
  const persistedLayout = usePersistedChannelLayout();
  const chCount = Array.isArray(core.displayAudio?.peakDb) ? core.displayAudio.peakDb.length : 0;
  const layoutResolution = useMemo(
    () => resolveChannelLayout(persistedLayout, { channelCount: chCount }),
    [persistedLayout, chCount]
  );
  return (
    <div className="p-2">
      <PeakPanel
        displayAudio={core.displayAudio}
        peakLabelContext={{
          channelLayout: persistedLayout,
          resolvedLayout: layoutResolution.resolved,
        }}
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
  const persistedLayout = usePersistedChannelLayout();
  const chCount = Array.isArray(core.displayAudio?.peakDb) ? core.displayAudio.peakDb.length : 0;
  const layoutResolution = useMemo(
    () => resolveChannelLayout(persistedLayout, { channelCount: chCount }),
    [persistedLayout, chCount]
  );
  const vsGridDiagInset = useMemo(() => {
    const pct = getBuiltinTheme(core.resolvedThemeId).charts.vectorscope.gridDiagInsetPct ?? 0;
    return Math.max(0, Math.min(20, pct));
  }, [core.resolvedThemeId]);
  const vsGridDiagFar = 100 - vsGridDiagInset;
  return (
    <div className="p-2">
      <VectorscopePanel
        vsGridDiagInset={vsGridDiagInset}
        vsGridDiagFar={vsGridDiagFar}
        displayVectorPath={core.displayVectorPath}
        selectedOffset={core.selectedOffset}
        correlation={core.correlation}
        channelCount={chCount}
        peakLabelContext={{
          channelLayout: persistedLayout,
          resolvedLayout: layoutResolution.resolved,
        }}
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
  const { resolvedThemeId } = core;
  const reduceMotion = useReducedMotion();
  if (!PANELS.has(kind)) {
    return (
      <div className={cn(SHELL_PAGE, "flex-1 items-start p-4")}>
        <Card className="max-w-lg border-dashed border-muted-foreground/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Unknown float panel. Use{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">?float=peak|loudness|spectrum|vector</code>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!isTauri()) {
    return (
      <div className={cn(SHELL_PAGE, "flex-1 items-start p-4")}>
        <Card className="max-w-lg border-dashed border-muted-foreground/40">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Float panels are for the Tauri desktop build only. Run{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">npm run desktop</code>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className={cn(SHELL_PAGE, "min-h-0")}>
      <div className={cn(SHELL_INNER, "flex min-h-0 min-w-0 flex-1 flex-col")}>
        {!core.engineRunning ? (
          <main className="min-h-0 flex-1 p-3 text-sm text-muted-foreground">
            The main window is not running the audio engine. Open AudioMeter, choose an input, and press <strong>START</strong> — this window
            will mirror the same data.
          </main>
        ) : kind === "loudness" ? (
          <main key={core.historyViewEpoch} className="min-h-0 min-w-0 flex-1 overflow-auto p-1">
            <FloatLoudnessBody core={core} />
          </main>
        ) : (
          <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
            <AnimatePresence mode="wait">
              {kind === "peak" ? (
                <motion.div
                  key="float-peak"
                  className="min-h-0 min-w-0"
                  initial={reduceMotion ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FloatPeakView core={core} resolvedThemeId={resolvedThemeId} />
                </motion.div>
              ) : kind === "spectrum" ? (
                <motion.div
                  key="float-spectrum"
                  className="min-h-0 min-w-0"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FloatSpectrumView core={core} />
                </motion.div>
              ) : (
                <motion.div
                  key="float-vector"
                  className="min-h-0 min-w-0"
                  initial={reduceMotion ? false : { opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <FloatVectorView core={core} />
                </motion.div>
              )}
            </AnimatePresence>
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
