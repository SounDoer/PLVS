import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { PANEL_MIN_HISTORY } from "@/lib/shellLayout";
import { HelpPopover } from "../HelpPopover";
import { LoudnessHistoryChart } from "./LoudnessHistoryChart";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { useChartHover } from "../../hooks/useChartHover";
import { computeHistoryHoverPoint } from "../../math/hoverMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

const LOUDNESS_HELP = [
  "Left click - Select snapshot",
  "Left drag - Scrub timeline",
  "Left double-click - Return to live",
  "Right drag - Pan timeline",
  "Right double-click - Reset window and offset",
  "Mouse wheel - Wheel up/down to zoom in/out",
];

export function LoudnessPanel({ compact = false }) {
  const historyTickSteps = HISTORY_TIME_TICK_STEPS;
  const {
    historyYAxisTicks,
    targetLufs,
    referenceLufs,
    hasHistoryData,
    historyChartInteractive,
    running,
    setSelectedOffset,
    setStatus,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    loudnessHistoryVisibleLayerIds,
    displayHistoryPathM,
    displayHistoryPathST,
    selectedOffset,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    clampedWindowSec,
    effectiveOffsetSec,
    historyTimeTicks,
    histSourceList,
    effectiveOffsetSamples,
    visibleSamples,
  } = useAudioData();

  const {
    hover: historyHover,
    onMove: onHistoryHoverMove,
    onLeave: onHistoryHoverLeave,
  } = useChartHover((xFrac) =>
    historyChartInteractive
      ? computeHistoryHoverPoint(
          xFrac,
          histSourceList,
          effectiveOffsetSamples,
          visibleSamples,
          HIST_SAMPLE_SEC
        )
      : null
  );

  return (
    <div
      className={cn(
        PANEL_MIN_HISTORY,
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="pointer-events-none absolute right-[var(--ui-panel-pad-x)] top-[var(--ui-panel-pad-y)] z-10">
        <div className="pointer-events-auto">
          <HelpPopover items={LOUDNESS_HELP} />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <LoudnessHistoryChart
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
          loudnessHistoryVisibleLayerIds={loudnessHistoryVisibleLayerIds}
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
          referenceLufs={referenceLufs}
          onHistoryHoverMove={onHistoryHoverMove}
          onHistoryHoverLeave={onHistoryHoverLeave}
        />
      </div>
    </div>
  );
}
