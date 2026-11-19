import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_PREFERENCES } from "../uiPreferences.js";
import {
  buildHistoryTimeAxisLabels,
  buildMediaTimeAxisLabels,
  buildFileHistoryTimeAxisLabels,
  getHistoryViewport,
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_MIN_WINDOW_SEC,
  mediaTimeAxisRangeSec,
} from "../math/historyMath.js";
import { useHistoryData } from "../workspace/AudioDataContext.jsx";
import { HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { useHistoryInteraction } from "./useHistoryInteraction.js";
import { nearestTimestampIndex } from "../lib/snapshotResolve.js";
import { historyTimestampAt, latestHistoryTimestampMs } from "../lib/historyTimestamps.js";

const TIMELINE_MODULE_IDS = new Set(["loudness", "spectrogram", "waveform"]);

/**
 * Adds the viewport-derived data, interaction handlers and HUD lifecycle owned by one timeline
 * panel mount. The raw viewport still comes from the global history model until the time axis kind
 * is introduced; keeping this boundary local means that change only has to replace the input.
 * @param {string} moduleId
 */
export function usePanelHistoryData(moduleId, axisViewportData = null, controls = {}) {
  const historyData = useHistoryData();
  const isTimelinePanel = TIMELINE_MODULE_IDS.has(moduleId);
  const timeViewport = axisViewportData?.axisViewports?.time ?? null;
  const timeViewportRef = useRef(timeViewport);
  useEffect(() => {
    timeViewportRef.current = timeViewport;
  }, [timeViewport]);
  const [historyHudHold, setHistoryHudHold] = useState(false);
  const [isHudTimerActive, setIsHudTimerActive] = useState(false);
  const hudTimerRef = useRef(null);

  const setHistoryHudUntilTs = useCallback((/** @type {number} */ ts) => {
    clearTimeout(hudTimerRef.current);
    const remaining = ts - Date.now();
    setIsHudTimerActive(remaining > 0);
    hudTimerRef.current =
      remaining > 0 ? setTimeout(() => setIsHudTimerActive(false), remaining + 24) : null;
  }, []);

  useEffect(() => () => clearTimeout(hudTimerRef.current), []);

  const totalSamples = historyData?.histSourceList?.length ?? 0;
  const fileHistory = historyData?.sourceMode === "file" ? historyData.histSourceList : null;
  const historyMaxWindowSec = fileHistory
    ? Math.max(HISTORY_MIN_WINDOW_SEC, totalSamples * HIST_SAMPLE_SEC)
    : (historyData?.historyMaxWindowSec ?? HISTORY_MAX_WINDOW_SEC);
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
  const viewport = getHistoryViewport(
    totalSamples,
    historyWindowSec,
    historyOffsetSec,
    HIST_SAMPLE_SEC,
    historyMaxWindowSec
  );
  const fileTimeRange =
    fileHistory?.length && moduleId === "spectrogram"
      ? mediaTimeAxisRangeSec(
          totalSamples,
          viewport.effectiveOffsetSamples,
          viewport.visibleSamples,
          HIST_SAMPLE_SEC,
          fileHistory
        )
      : null;

  const selectedFileIndex = fileHistory
    ? nearestTimestampIndex(fileHistory, historyData.selectedMediaTimestampMs)
    : -1;
  const selectedHistSteps =
    selectedFileIndex >= 0
      ? totalSamples - 1 - selectedFileIndex
      : historyData?.selectedOffset >= 0
        ? Math.max(0, Math.round(historyData.selectedOffset / HIST_SAMPLE_SEC))
        : -1;
  const selectTimelineSnapshot = useCallback(
    (/** @type {number} */ offsetSec) => {
      if (fileHistory?.length) {
        const index = fileHistory.length - 1 - Math.round(offsetSec / HIST_SAMPLE_SEC);
        const time = historyTimestampAt(fileHistory, index);
        const latest = latestHistoryTimestampMs(fileHistory);
        if (Number.isFinite(latest) && Number.isFinite(time)) {
          historyData.selectSnapshot((latest - time) / 1000);
          return;
        }
      }
      historyData?.selectSnapshot?.(offsetSec);
    },
    [fileHistory, historyData]
  );
  const selectMediaSnapshot = useCallback(
    (fraction) => {
      const timeSec =
        fileTimeRange.startSec + fraction * (fileTimeRange.endSec - fileTimeRange.startSec);
      const latest =
        latestHistoryTimestampMs(fileHistory) ?? (fileHistory.length - 1) * HIST_SAMPLE_SEC * 1000;
      historyData.selectSnapshot(Math.max(0, latest / 1000 - timeSec));
    },
    [fileHistory, fileTimeRange, historyData]
  );
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
  const selectionFraction =
    fileTimeRange && selectedFileIndex >= 0 && fileTimeRange.endSec > fileTimeRange.startSec
      ? (historyData.selectedMediaTimestampMs / 1000 - fileTimeRange.startSec) /
        (fileTimeRange.endSec - fileTimeRange.startSec)
      : 1 -
        (selectedHistSteps - viewport.effectiveOffsetSamples) /
          Math.max(1, viewport.visibleSamples - 1);
  const selLineX = 600 * Math.max(0, Math.min(1, selectionFraction));

  const liveTimeTicks = useMemo(
    () =>
      buildHistoryTimeAxisLabels(
        viewport.effectiveOffsetSec,
        viewport.visibleSamples * HIST_SAMPLE_SEC
      ),
    [viewport.effectiveOffsetSec, viewport.visibleSamples]
  );

  const interaction = useHistoryInteraction({
    orientation:
      moduleId === "spectrogram" && controls?.spectrogramMode !== "heatmap"
        ? "right-to-left"
        : (controls?.[`${moduleId}Orientation`] ?? "right-to-left"),
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
    selectSnapshot: historyData?.selectSnapshot ? selectTimelineSnapshot : undefined,
    selectSnapshotAtFraction:
      fileTimeRange && historyData?.selectSnapshot ? selectMediaSnapshot : null,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    setHistoryHudUntilTs,
    setHistoryHudHold,
  });

  if (!isTimelinePanel) return historyData;

  const historyTimeTicks = fileTimeRange
    ? buildMediaTimeAxisLabels(fileTimeRange.startSec, fileTimeRange.endSec)
    : fileHistory
      ? buildFileHistoryTimeAxisLabels(
          fileHistory,
          viewport.effectiveOffsetSamples,
          viewport.visibleSamples,
          HIST_SAMPLE_SEC
        )
      : liveTimeTicks;
  return {
    ...historyData,
    historyMaxWindowSec,
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
    fileTimeRange,
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
