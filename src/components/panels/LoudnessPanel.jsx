import { useHistoryData, usePanelInstanceData } from "../../workspace/AudioDataContext.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PANEL_MIN_HISTORY } from "@/lib/shellLayout";
import { LoudnessHistoryChart } from "./LoudnessHistoryChart";
import {
  buildHistoryPath,
  buildLoudnessHistoryPathsFromIndex,
  HISTORY_TIME_TICK_STEPS,
} from "../../math/historyMath";
import { useChartHover } from "../../hooks/useChartHover";
import { computeHistoryHoverPoint } from "../../math/hoverMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { loudnessHistY } from "../../config/scales";
import { normalizePanelControls } from "../../lib/panelControls.js";

export function LoudnessPanel({ compact = false }) {
  const historyTickSteps = HISTORY_TIME_TICK_STEPS;
  const {
    hasHistoryData,
    historyChartInteractive,
    running,
    setSelectedOffset,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    historyTimeAxisHandlers,
    historyTimeAxisActive,
    selectedOffset,
    showSelLine,
    selLineX,
    historyTimeTicks,
    effectiveOffsetSec,
    histSourceList,
    loudnessDisplayIndex,
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
    referenceLufs,
    momentaryRules,
    shortTermRules,
  } = useHistoryData();
  const { panelControls, onPanelControlsChange } = usePanelInstanceData();

  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const loudnessYMinDb = normalizedPanelControls.loudnessYMinDb;
  const loudnessYMaxDb = normalizedPanelControls.loudnessYMaxDb;
  // Owned by the active Loudness Profile and delivered through the history context; null when
  // the profile is Off, which is what keeps a phantom reference line off the chart.
  const targetLufs = referenceLufs;
  const loudnessYRange = useMemo(
    () => ({ min: loudnessYMinDb, max: loudnessYMaxDb }),
    [loudnessYMinDb, loudnessYMaxDb]
  );
  const loudnessHistoryVisibleLayerIds = normalizedPanelControls.loudnessHistoryVisibleLayerIds;
  // Real plot width (CSS px) drives the decimation column budget so the envelope matches screen
  // resolution instead of the fixed 600-unit SVG coordinate space. 0 until first measurement.
  const plotAreaRef = useRef(null);
  const [plotWidthPx, setPlotWidthPx] = useState(0);
  useEffect(() => {
    const el = plotAreaRef.current;
    if (!el) return;
    let rafId = 0;
    const measure = () => {
      rafId = 0;
      const w = Math.round(el.clientWidth);
      setPlotWidthPx((prev) => (prev === w ? prev : w));
    };
    const ro = new ResizeObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);
  const targetColumns = plotWidthPx > 0 ? plotWidthPx : undefined;
  // histSourceList is a stable, mutated-in-place ring buffer, so its reference never changes between
  // frames even as samples are appended. totalSamples alone is not enough to key the memo: once the
  // ring fills, its length caps and stops changing even though pushes keep advancing the data, so
  // the memo would freeze the curve on long (> retention) sessions. The newest sample's timestamp keeps
  // advancing every tick regardless of fill state, so keying on it captures new data without freezing,
  // and still avoids rebuilding the (decimated) path on unrelated re-renders (hover, sibling state).
  // The combined indexed builder shares each display-column query across M and ST.
  const latestSampleTimestampMs =
    totalSamples > 0
      ? typeof histSourceList.rowAt === "function"
        ? histSourceList.rowAt(totalSamples - 1)?.timestampMs
        : histSourceList[totalSamples - 1]?.timestampMs
      : undefined;
  const displayHistoryPathsForRange = useMemo(() => {
    const toY = (value) => loudnessHistY(value, 220, loudnessYRange);
    return loudnessDisplayIndex
      ? buildLoudnessHistoryPathsFromIndex(
          histSourceList,
          loudnessDisplayIndex,
          visibleSamples,
          effectiveOffsetSamples,
          toY,
          600,
          targetColumns
        )
      : {
          m: buildHistoryPath(
            histSourceList,
            "m",
            visibleSamples,
            effectiveOffsetSamples,
            toY,
            600,
            targetColumns
          ),
          st: buildHistoryPath(
            histSourceList,
            "st",
            visibleSamples,
            effectiveOffsetSamples,
            toY,
            600,
            targetColumns
          ),
        };
  }, [
    histSourceList,
    loudnessDisplayIndex,
    totalSamples,
    latestSampleTimestampMs,
    visibleSamples,
    effectiveOffsetSamples,
    loudnessYRange,
    targetColumns,
  ]);
  const displayHistoryPathMForRange = displayHistoryPathsForRange.m;
  const displayHistoryPathSTForRange = displayHistoryPathsForRange.st;
  const onLoudnessYRangeChange = useCallback(
    (newMin, newMax) => {
      onPanelControlsChange?.(
        normalizePanelControls({
          ...normalizedPanelControls,
          loudnessYMinDb: newMin,
          loudnessYMaxDb: newMax,
        })
      );
    },
    [normalizedPanelControls, onPanelControlsChange]
  );

  const {
    hover: historyHover,
    onMove: onHistoryHoverMove,
    onLeave: onHistoryHoverLeave,
  } = useChartHover(
    (xFrac) =>
      historyChartInteractive
        ? computeHistoryHoverPoint(
            xFrac,
            histSourceList,
            effectiveOffsetSamples,
            visibleSamples,
            HIST_SAMPLE_SEC,
            loudnessYRange,
            loudnessHistoryVisibleLayerIds
          )
        : null,
    selectedOffset < 0
      ? `${totalSamples ?? 0}:${effectiveOffsetSamples}:${visibleSamples}:${loudnessYMinDb}:${loudnessYMaxDb}:${loudnessHistoryVisibleLayerIds.join(",")}`
      : null
  );

  return (
    <div
      className={cn(
        PANEL_MIN_HISTORY,
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <LoudnessHistoryChart
          plotAreaRef={plotAreaRef}
          targetLufs={targetLufs}
          loudnessYMinDb={normalizedPanelControls.loudnessYMinDb}
          loudnessYMaxDb={normalizedPanelControls.loudnessYMaxDb}
          onLoudnessYRangeChange={onLoudnessYRangeChange}
          hasHistoryData={hasHistoryData}
          historyChartInteractive={historyChartInteractive}
          running={running}
          setSelectedOffset={setSelectedOffset}
          holdHistoryHud={holdHistoryHud}
          showHistoryHud={showHistoryHud}
          onHistoryWheel={onHistoryWheel}
          onHistoryPointerDown={onHistoryPointerDown}
          onHistoryPointerMove={onHistoryPointerMove}
          onHistoryPointerUp={onHistoryPointerUp}
          historyTimeAxisHandlers={historyTimeAxisHandlers}
          isTimeAxisActive={historyTimeAxisActive}
          loudnessHistoryVisibleLayerIds={loudnessHistoryVisibleLayerIds}
          displayHistoryPathM={displayHistoryPathMForRange}
          displayHistoryPathST={displayHistoryPathSTForRange}
          selectedOffset={selectedOffset}
          showSelLine={showSelLine}
          selLineX={selLineX}
          historyHover={historyHover}
          historyTimeTicks={historyTimeTicks}
          historyTickSteps={historyTickSteps}
          showLatestEdgeHint={effectiveOffsetSec > 0}
          referenceLufs={referenceLufs}
          momentaryRules={momentaryRules}
          shortTermRules={shortTermRules}
          onHistoryHoverMove={onHistoryHoverMove}
          onHistoryHoverLeave={onHistoryHoverLeave}
        />
      </div>
    </div>
  );
}
