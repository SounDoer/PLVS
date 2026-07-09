import { useHistoryData, usePanelInstanceData } from "../../workspace/AudioDataContext.jsx";
import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { PANEL_MIN_HISTORY } from "@/lib/shellLayout";
import { LoudnessHistoryChart } from "./LoudnessHistoryChart";
import { buildHistoryPath, HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
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
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
  } = useHistoryData();
  const { panelControls, onPanelControlsChange } = usePanelInstanceData();

  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const loudnessYMinDb = normalizedPanelControls.loudnessYMinDb;
  const loudnessYMaxDb = normalizedPanelControls.loudnessYMaxDb;
  const referenceLufs = normalizedPanelControls.loudnessReferenceLufs;
  const targetLufs = referenceLufs;
  const loudnessYRange = useMemo(
    () => ({ min: loudnessYMinDb, max: loudnessYMaxDb }),
    [loudnessYMinDb, loudnessYMaxDb]
  );
  const loudnessHistoryVisibleLayerIds = normalizedPanelControls.loudnessHistoryVisibleLayerIds;
  // Computed inline (not memoized): histSourceList is a stable, mutated-in-place ring buffer, so its
  // reference never changes between frames even as samples are appended. Memoizing on it would freeze
  // the curve. Cheap enough to rebuild each render.
  const displayHistoryPathMForRange = buildHistoryPath(
    histSourceList,
    "m",
    visibleSamples,
    effectiveOffsetSamples,
    (v) => loudnessHistY(v, 220, loudnessYRange)
  );
  const displayHistoryPathSTForRange = buildHistoryPath(
    histSourceList,
    "st",
    visibleSamples,
    effectiveOffsetSamples,
    (v) => loudnessHistY(v, 220, loudnessYRange)
  );
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
          onHistoryHoverMove={onHistoryHoverMove}
          onHistoryHoverLeave={onHistoryHoverLeave}
        />
      </div>
    </div>
  );
}
