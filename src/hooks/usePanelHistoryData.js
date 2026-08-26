import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_PREFERENCES } from "../uiPreferences.js";
import {
  buildHistoryTimeAxisLabels,
  buildMediaTimeAxisLabels,
  getHistoryViewport,
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_MIN_WINDOW_SEC,
  mediaTimeAxisRangeSec,
} from "../math/historyMath.js";
import { useHistoryData } from "../workspace/AudioDataContext.jsx";
import { HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { useHistoryInteraction } from "./useHistoryInteraction.js";

const TIMELINE_MODULE_IDS = new Set(["loudness", "spectrogram", "waveform"]);

/**
 * Adds the viewport-derived data, interaction handlers and HUD lifecycle owned by one timeline
 * panel mount. The raw viewport still comes from the global history model until the time axis kind
 * is introduced; keeping this boundary local means that change only has to replace the input.
 */
export function usePanelHistoryData(moduleId, axisViewportData = null) {
  const historyData = useHistoryData();
  const isTimelinePanel = TIMELINE_MODULE_IDS.has(moduleId);
  const timeViewport = axisViewportData?.axisViewports?.time ?? null;
  const timeViewportRef = useRef(timeViewport);
  useEffect(() => {
    timeViewportRef.current = timeViewport;
  }, [timeViewport]);
  const [historyHudHold, setHistoryHudHold] = useState(false);
  const [isHudTimerActive, setIsHudTimerActive] = useState(false);
  const hudUntilTsRef = useRef(0);

  const setHistoryHudUntilTs = useCallback((ts) => {
    hudUntilTsRef.current = ts;
    setIsHudTimerActive(ts > Date.now());
  }, []);

  useEffect(() => {
    if (!isTimelinePanel || historyHudHold || !isHudTimerActive) return;
    const remain = hudUntilTsRef.current - Date.now();
    if (remain <= 0) {
      setIsHudTimerActive(false);
      return;
    }
    const timer = setTimeout(() => setIsHudTimerActive(false), remain + 24);
    return () => clearTimeout(timer);
  }, [historyHudHold, isHudTimerActive, isTimelinePanel]);

  const totalSamples = historyData?.histSourceList?.length ?? 0;
  const historyMaxWindowSec = historyData?.historyMaxWindowSec ?? HISTORY_MAX_WINDOW_SEC;
  const historyWindowSec =
    timeViewport?.windowSec ??
    historyData?.historyWindowSec ??
    historyData?.clampedWindowSec ??
    UI_PREFERENCES.modules.loudness.history.defaultWindowSec;
  const historyOffsetSec =
    timeViewport?.offsetSec ??
    historyData?.historyOffsetSec ??
    historyData?.effectiveOffsetSec ??
    0;
  const setHistoryWindowSec = useCallback(
    (nextWindowSec) => {
      const current = timeViewportRef.current;
      if (!current) {
        historyData?.setHistoryWindowSec?.(nextWindowSec);
        return;
      }
      const value =
        typeof nextWindowSec === "function" ? nextWindowSec(current.windowSec) : nextWindowSec;
      const next = {
        windowSec: value,
        offsetSec: current.offsetSec,
      };
      timeViewportRef.current = { ...next, linked: current.linked };
      axisViewportData?.setAxisViewportValue?.("time", next);
    },
    [axisViewportData, historyData]
  );
  const setHistoryOffsetSec = useCallback(
    (nextOffsetSec) => {
      const current = timeViewportRef.current;
      if (!current) {
        historyData?.setHistoryOffsetSec?.(nextOffsetSec);
        return;
      }
      const value =
        typeof nextOffsetSec === "function" ? nextOffsetSec(current.offsetSec) : nextOffsetSec;
      const next = {
        windowSec: current.windowSec,
        offsetSec: value,
      };
      timeViewportRef.current = { ...next, linked: current.linked };
      axisViewportData?.setAxisViewportValue?.("time", next);
    },
    [axisViewportData, historyData]
  );
  const fileMaxWindowSec = totalSamples * HIST_SAMPLE_SEC;
  const effectiveWindowSec =
    historyData?.sourceMode === "file" && totalSamples > 0
      ? Math.min(historyWindowSec, fileMaxWindowSec)
      : Math.min(historyWindowSec, historyMaxWindowSec);
  const viewport = getHistoryViewport(
    totalSamples,
    effectiveWindowSec,
    historyOffsetSec,
    HIST_SAMPLE_SEC,
    historyMaxWindowSec
  );

  const selectedHistSteps =
    historyData?.selectedOffset >= 0
      ? Math.max(0, Math.round(historyData.selectedOffset / HIST_SAMPLE_SEC))
      : -1;
  const hasValidSelection =
    historyData?.selectedOffset >= 0 &&
    totalSamples > 0 &&
    selectedHistSteps >= 0 &&
    selectedHistSteps < totalSamples;
  const firstVisibleSelectionStep = viewport.effectiveOffsetSamples;
  const lastVisibleSelectionStep =
    viewport.effectiveOffsetSamples + Math.max(0, viewport.visibleSamples - 1);
  const showSelLine =
    hasValidSelection &&
    selectedHistSteps >= firstVisibleSelectionStep &&
    selectedHistSteps <= lastVisibleSelectionStep;
  const selectionEdge = !hasValidSelection
    ? null
    : selectedHistSteps < firstVisibleSelectionStep
      ? "right"
      : selectedHistSteps > lastVisibleSelectionStep
        ? "left"
        : null;
  const selLineX = Math.max(
    0,
    Math.min(
      600,
      600 -
        ((selectedHistSteps - viewport.effectiveOffsetSamples) /
          Math.max(1, viewport.visibleSamples - 1)) *
          600
    )
  );

  const historyTimeTicks = useMemo(() => {
    if (historyData?.sourceMode === "file") {
      const { startSec, endSec } = mediaTimeAxisRangeSec(
        totalSamples,
        viewport.effectiveOffsetSamples,
        viewport.visibleSamples,
        HIST_SAMPLE_SEC
      );
      return buildMediaTimeAxisLabels(startSec, endSec);
    }
    return buildHistoryTimeAxisLabels(
      viewport.effectiveOffsetSec,
      viewport.visibleSamples * HIST_SAMPLE_SEC
    );
  }, [
    historyData?.sourceMode,
    totalSamples,
    viewport.effectiveOffsetSamples,
    viewport.effectiveOffsetSec,
    viewport.visibleSamples,
  ]);

  const interaction = useHistoryInteraction({
    enabled: isTimelinePanel && (historyData?.running || historyData?.hasHistoryData),
    sampleSec: HIST_SAMPLE_SEC,
    minWindowSec: HISTORY_MIN_WINDOW_SEC,
    maxWindowSec: historyMaxWindowSec,
    defaultWindowSec: UI_PREFERENCES.modules.loudness.history.defaultWindowSec,
    totalSamples,
    visibleSamples: viewport.visibleSamples,
    maxOffsetSamples: viewport.maxOffsetSamples,
    effectiveOffsetSamples: viewport.effectiveOffsetSamples,
    effectiveOffsetSec: viewport.effectiveOffsetSec,
    setSelectedOffset: historyData?.setSelectedOffset,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    setHistoryHudUntilTs,
    setHistoryHudHold,
  });

  if (!isTimelinePanel) return historyData;

  return {
    ...historyData,
    historyWindowSec,
    historyOffsetSec,
    setHistoryWindowSec,
    setHistoryOffsetSec,
    historyChartInteractive: historyData?.running || historyData?.hasHistoryData,
    totalSamples,
    ...viewport,
    selectedHistSteps,
    showSelLine,
    selectionEdge,
    selLineX,
    isHistoryHudVisible:
      (historyData?.running || historyData?.hasHistoryData) && (historyHudHold || isHudTimerActive),
    historyTimeTicks,
    holdHistoryHud: interaction.holdHistoryHud,
    showHistoryHud: interaction.showHistoryHud,
    onHistoryPointerDown: interaction.onHistoryPointerDown,
    onHistoryPointerMove: interaction.onHistoryPointerMove,
    onHistoryPointerUp: interaction.onHistoryPointerUp,
    onHistoryWheel: interaction.onHistoryWheel,
    historyTimeAxisHandlers: interaction.historyTimeAxisHandlers,
    historyTimeAxisActive: interaction.isTimeAxisActive,
  };
}
