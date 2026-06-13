import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loudnessHistY, LOUDNESS_TICKS } from "../config/scales";
import {
  buildHistoryPath,
  buildHistoryTimeAxisLabels,
  buildLoudnessYAxisTicks,
  getHistoryViewport,
} from "../math/historyMath";
import { fmtMetric } from "../math/formatMath";
import { UI_PREFERENCES } from "../uiPreferences";
import { LOUDNESS_STATS_META } from "@/lib/panelControls.js";

export function dialogueOffsetText(dialogueIntegrated, integrated) {
  if (!Number.isFinite(dialogueIntegrated) || !Number.isFinite(integrated)) return "-";
  const d = dialogueIntegrated - integrated;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
}

export const HIST_SAMPLE_SEC = 0.1;
export const VISUAL_HIST_SAMPLE_SEC = 0.04;

const CHART_HEIGHT_PX = 220;

/**
 * History viewport state, derived display data, and loudness metrics for LoudnessPanel.
 *
 * @param {{ histSourceList, hasHistoryData, running, displayAudio, referenceLufs, selectedOffset }} params
 */
export function useLoudnessHistory({
  histSourceList,
  hasHistoryData,
  running,
  displayAudio,
  referenceLufs,
  selectedOffset,
}) {
  const [historyWindowSec, setHistoryWindowSec] = useState(
    UI_PREFERENCES.modules.loudness.history.defaultWindowSec
  );
  const [historyOffsetSec, setHistoryOffsetSec] = useState(0);
  const [historyHudHold, setHistoryHudHold] = useState(false);
  const [isHudTimerActive, setIsHudTimerActive] = useState(false);
  const hudUntilTsRef = useRef(0);

  const historyChartInteractive = running || hasHistoryData;

  // Stable setter exported to callers (useHistoryInteraction); stores timestamp in a ref
  // and activates the boolean timer-active state so the effect below schedules the dismiss.
  const setHistoryHudUntilTs = useCallback((ts) => {
    hudUntilTsRef.current = ts;
    setIsHudTimerActive(ts > Date.now());
  }, []);

  // Auto-dismiss: schedule clearance when timer-active state is set
  useEffect(() => {
    if (historyHudHold || !isHudTimerActive) return;
    const remain = hudUntilTsRef.current - Date.now();
    if (remain <= 0) {
      setIsHudTimerActive(false);
      return;
    }
    const t = setTimeout(() => setIsHudTimerActive(false), remain + 24);
    return () => clearTimeout(t);
  }, [isHudTimerActive, historyHudHold]);

  // --- Viewport & display paths ---

  const totalSamples = histSourceList.length;
  const {
    clampedWindowSec,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
  } = getHistoryViewport(totalSamples, historyWindowSec, historyOffsetSec, HIST_SAMPLE_SEC);

  const displayHistoryPathM = buildHistoryPath(
    histSourceList,
    "m",
    visibleSamples,
    effectiveOffsetSamples,
    (v) => loudnessHistY(v, CHART_HEIGHT_PX)
  );
  const displayHistoryPathST = buildHistoryPath(
    histSourceList,
    "st",
    visibleSamples,
    effectiveOffsetSamples,
    (v) => loudnessHistY(v, CHART_HEIGHT_PX)
  );

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / HIST_SAMPLE_SEC)) : -1;
  const showSelLine =
    selectedOffset >= 0 &&
    totalSamples > 0 &&
    selectedHistSteps >= 0 &&
    selectedHistSteps < totalSamples;
  const isHistoryHudVisible = historyChartInteractive && (historyHudHold || isHudTimerActive);
  const selLineX = Math.max(
    0,
    Math.min(
      600,
      600 - ((selectedHistSteps - effectiveOffsetSamples) / Math.max(1, visibleSamples - 1)) * 600
    )
  );

  const historyTimeTicks = useMemo(
    () => buildHistoryTimeAxisLabels(effectiveOffsetSec, visibleSamples * HIST_SAMPLE_SEC),
    [effectiveOffsetSec, visibleSamples]
  );

  // --- Loudness metrics for LoudnessPanel ---

  const targetLufs = Number.isFinite(referenceLufs) ? referenceLufs : -23;

  const historyYAxisTicks = useMemo(
    () => buildLoudnessYAxisTicks(targetLufs, LOUDNESS_TICKS),
    [targetLufs]
  );

  const psr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.shortTerm)
      ? displayAudio.tpMax - displayAudio.shortTerm
      : -Infinity;
  const plr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.integrated)
      ? displayAudio.tpMax - displayAudio.integrated
      : -Infinity;

  const primaryMetrics = useMemo(
    () => [
      {
        id: "momentary",
        ...LOUDNESS_STATS_META.momentary,
        value: fmtMetric(displayAudio.momentary),
      },
      {
        id: "shortTerm",
        ...LOUDNESS_STATS_META.shortTerm,
        value: fmtMetric(displayAudio.shortTerm),
      },
      {
        id: "integrated",
        ...LOUDNESS_STATS_META.integrated,
        value: fmtMetric(displayAudio.integrated),
      },
      {
        id: "momentaryMax",
        ...LOUDNESS_STATS_META.momentaryMax,
        value: fmtMetric(displayAudio.mMax),
      },
      {
        id: "shortTermMax",
        ...LOUDNESS_STATS_META.shortTermMax,
        value: fmtMetric(displayAudio.stMax),
      },
      { id: "lra", ...LOUDNESS_STATS_META.lra, value: fmtMetric(displayAudio.lra) },
    ],
    [displayAudio]
  );

  const secondaryMetrics = useMemo(
    () => [
      { id: "psr", ...LOUDNESS_STATS_META.psr, value: fmtMetric(psr) },
      { id: "plr", ...LOUDNESS_STATS_META.plr, value: fmtMetric(plr) },
      {
        id: "dialogueCoverage",
        ...LOUDNESS_STATS_META.dialogueCoverage,
        value: Number.isFinite(displayAudio.dialoguePercent)
          ? `${displayAudio.dialoguePercent.toFixed(0)}`
          : "-",
      },
      {
        id: "dialogueIntegrated",
        ...LOUDNESS_STATS_META.dialogueIntegrated,
        value: fmtMetric(displayAudio.dialogueIntegrated),
      },
      {
        id: "dialogueRange",
        ...LOUDNESS_STATS_META.dialogueRange,
        value: fmtMetric(displayAudio.dialogueLra),
      },
      {
        id: "dialogueOffset",
        ...LOUDNESS_STATS_META.dialogueOffset,
        value: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
      },
    ],
    [psr, plr, displayAudio]
  );

  return {
    // State & setters (consumed by useHistoryInteraction and clearAll / reset flows)
    historyWindowSec,
    setHistoryWindowSec,
    historyOffsetSec,
    setHistoryOffsetSec,
    setHistoryHudUntilTs,
    historyHudHold,
    setHistoryHudHold,
    // Viewport
    historyChartInteractive,
    totalSamples,
    clampedWindowSec,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
    // Display
    displayHistoryPathM,
    displayHistoryPathST,
    selectedHistSteps,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    historyTimeTicks,
    // Metrics
    referenceLufs,
    targetLufs,
    historyYAxisTicks,
    primaryMetrics,
    secondaryMetrics,
  };
}
