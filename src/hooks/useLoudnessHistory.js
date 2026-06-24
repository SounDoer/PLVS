import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loudnessHistY, LOUDNESS_TICKS } from "../config/scales";
import {
  buildHistoryPath,
  buildHistoryTimeAxisLabels,
  buildMediaTimeAxisLabels,
  getHistoryViewport,
  mediaTimeAxisRangeSec,
} from "../math/historyMath";
import { UI_PREFERENCES } from "../uiPreferences";
import { buildStatsMetrics } from "@/lib/statsCatalog.js";
import { DEFAULT_REFERENCE_LUFS } from "../settings/defaults.js";

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
  sourceMode,
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
  // File mode shows a fixed-extent recording: cap the window to the whole file so zoom-out can never
  // exceed the data. Otherwise the window grows past the file and the content right-aligns, leaving a
  // gap on the left while the media-time axis still spans 0 -> duration (ambiguous). Live mode keeps
  // the unclamped window (its data grows over time).
  const fileMaxWindowSec = totalSamples * HIST_SAMPLE_SEC;
  const effectiveWindowSec =
    sourceMode === "file" && totalSamples > 0
      ? Math.min(historyWindowSec, fileMaxWindowSec)
      : historyWindowSec;
  const {
    clampedWindowSec,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
  } = getHistoryViewport(totalSamples, effectiveWindowSec, historyOffsetSec, HIST_SAMPLE_SEC);

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

  // File mode reads an absolute media-time axis (0 -> duration); live mode keeps the "time ago" axis.
  const historyTimeTicks = useMemo(() => {
    if (sourceMode === "file") {
      const { startSec, endSec } = mediaTimeAxisRangeSec(
        totalSamples,
        effectiveOffsetSamples,
        visibleSamples,
        HIST_SAMPLE_SEC
      );
      return buildMediaTimeAxisLabels(startSec, endSec);
    }
    return buildHistoryTimeAxisLabels(effectiveOffsetSec, visibleSamples * HIST_SAMPLE_SEC);
  }, [sourceMode, totalSamples, effectiveOffsetSamples, effectiveOffsetSec, visibleSamples]);

  // --- Loudness metrics for LoudnessPanel ---

  const targetLufs = Number.isFinite(referenceLufs) ? referenceLufs : DEFAULT_REFERENCE_LUFS;

  const historyYAxisTicks = LOUDNESS_TICKS;

  const statsMetrics = useMemo(() => buildStatsMetrics(displayAudio), [displayAudio]);

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
    statsMetrics,
  };
}
