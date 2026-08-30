import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { loudnessTraceGradientStops } from "@/lib/loudnessTraceColor.js";
import { RuleGradient } from "./LoudnessRuleGradient.jsx";
import { buildAdaptiveDbTicks, loudnessFromTopFrac } from "../../config/scales";
import { useAxisActivePulse } from "../../hooks/useAxisActivePulse";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { AxisRail, timeAxisInteraction } from "./AxisRail.jsx";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";
import { TimelineSelectionEdgeHint } from "./TimelineSelectionEdgeHint.jsx";
import {
  anchorFromPointer,
  panRange,
  zoomRange,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "../../math/axisInteractionMath.js";

// Both the y axis rail and the plot area edit this range, so the bounds live in one place.
const LOUDNESS_Y_VIEWPORT = { absMin: -64, absMax: 0, minSpan: 12, scale: "linear" };

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

const LOUDNESS_HUD_BOX_POPOVER =
  "rounded-xs border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm";

export function LoudnessHistoryChart({
  plotAreaRef,
  historyYAxisTicks: historyYAxisTicksProp,
  targetLufs,
  loudnessYMinDb = -64,
  loudnessYMaxDb = 0,
  onLoudnessYRangeChange,
  hasHistoryData,
  historyChartInteractive,
  setSelectedOffset,
  holdHistoryHud,
  showHistoryHud,
  onHistoryWheel,
  onHistoryPointerDown,
  onHistoryPointerMove,
  onHistoryPointerUp,
  historyTimeAxisHandlers,
  isTimeAxisActive = false,
  loudnessHistoryVisibleLayerIds = [],
  displayHistoryPathM,
  displayHistoryPathST,
  selectedOffset,
  showSelLine,
  selectionEdge,
  selLineX,
  historyHover,
  historyTimeTicks,
  historyTickSteps,
  showLatestEdgeHint = false,
  referenceLufs,
  momentaryRules,
  shortTermRules,
  onHistoryHoverMove,
  onHistoryHoverLeave,
}) {
  const visibleLayerIds = Array.isArray(loudnessHistoryVisibleLayerIds)
    ? loudnessHistoryVisibleLayerIds
    : [];
  const showMomentary = visibleLayerIds.includes("momentary");
  const showShortTerm = visibleLayerIds.includes("shortTerm");
  // With no active profile there is no reference to draw, so a stale `ref` id must not count as
  // a selected layer -- otherwise the empty state hides behind a layer that renders nothing.
  const showReference = visibleLayerIds.includes("ref") && Number.isFinite(referenceLufs);
  const hasSelectedLayer = showMomentary || showShortTerm || showReference;
  const loudnessYRange = useMemo(
    () => ({ min: loudnessYMinDb, max: loudnessYMaxDb }),
    [loudnessYMinDb, loudnessYMaxDb]
  );
  const loudnessYAxis = useAxisInteraction({
    axis: "y",
    min: loudnessYMinDb,
    max: loudnessYMaxDb,
    ...LOUDNESS_Y_VIEWPORT,
    defaultMin: LOUDNESS_Y_VIEWPORT.absMin,
    defaultMax: LOUDNESS_Y_VIEWPORT.absMax,
    onRangeChange: onLoudnessYRangeChange,
  });
  const {
    active: chartYAxisActive,
    pulse: pulseChartYAxis,
    hold: holdChartYAxis,
    release: releaseChartYAxis,
  } = useAxisActivePulse();
  const onChartWheel = useCallback(
    (e) => {
      if (!e.ctrlKey || typeof onLoudnessYRangeChange !== "function") {
        onHistoryWheel?.(e);
        return;
      }
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const next = zoomRange({
        min: loudnessYMinDb,
        max: loudnessYMaxDb,
        ...LOUDNESS_Y_VIEWPORT,
        anchor: anchorFromPointer({
          rect,
          clientY: e.clientY,
          axis: "y",
          scale: LOUDNESS_Y_VIEWPORT.scale,
          min: loudnessYMinDb,
          max: loudnessYMaxDb,
        }),
        factor: e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
      });
      onLoudnessYRangeChange(next.min, next.max);
      pulseChartYAxis();
    },
    [loudnessYMaxDb, loudnessYMinDb, onHistoryWheel, onLoudnessYRangeChange, pulseChartYAxis]
  );
  const adaptiveHistoryYAxisTicks = useMemo(
    () => buildAdaptiveDbTicks(loudnessYMinDb, loudnessYMaxDb, loudnessYAxis.axisPx),
    [loudnessYMinDb, loudnessYMaxDb, loudnessYAxis.axisPx]
  );
  const historyYAxisTicks = historyYAxisTicksProp ?? adaptiveHistoryYAxisTicks;

  const historyYAxisTicksLabeled = useMemo(
    () => historyYAxisTicks.filter((t) => !(t.v === targetLufs && !hasHistoryData)),
    [historyYAxisTicks, targetLufs, hasHistoryData]
  );

  const isSnap = selectedOffset >= 0;
  const mStrokeNormal = isSnap
    ? "var(--ui-loudness-momentary-snap)"
    : "var(--ui-loudness-momentary)";
  const stStrokeNormal = isSnap
    ? "var(--ui-loudness-shortterm-snap)"
    : "var(--ui-loudness-shortterm)";
  const refTopFrac = Number.isFinite(referenceLufs)
    ? loudnessFromTopFrac(referenceLufs, loudnessYRange)
    : null;

  // A trace tints where its own rules breach; with no rules (all built-ins) it stays plain.
  const mStops = useMemo(
    () => loudnessTraceGradientStops(momentaryRules, loudnessYRange, mStrokeNormal),
    [momentaryRules, loudnessYRange, mStrokeNormal]
  );
  const stStops = useMemo(
    () => loudnessTraceGradientStops(shortTermRules, loudnessYRange, stStrokeNormal),
    [shortTermRules, loudnessYRange, stStrokeNormal]
  );
  const mGradId = useId().replace(/:/g, "");
  const stGradId = useId().replace(/:/g, "");

  const chartYDragRef = useRef(null);
  const [chartDragging, setChartDragging] = useState(false);
  const { isCtrlHover, notePointerMove, notePointerLeave } = useCtrlHoverState();

  const onChartPointerDown = useCallback(
    (e) => {
      if (e.ctrlKey && e.button === 0 && typeof onLoudnessYRangeChange === "function") {
        chartYDragRef.current = {
          startY: e.clientY,
          min: loudnessYMinDb,
          max: loudnessYMaxDb,
        };
        setChartDragging(true);
        holdChartYAxis();
      }
      onHistoryPointerDown?.(e);
    },
    [holdChartYAxis, loudnessYMaxDb, loudnessYMinDb, onHistoryPointerDown, onLoudnessYRangeChange]
  );

  const onChartPointerMove = useCallback(
    (e) => {
      notePointerMove(e);
      onHistoryPointerMove?.(e);
      const drag = chartYDragRef.current;
      if (drag && typeof onLoudnessYRangeChange === "function") {
        const rect = e.currentTarget.getBoundingClientRect();
        const next = panRange({
          min: drag.min,
          max: drag.max,
          ...LOUDNESS_Y_VIEWPORT,
          deltaPx: e.clientY - drag.startY,
          axisPx: Math.max(1, rect.height),
        });
        onLoudnessYRangeChange(next.min, next.max);
        holdChartYAxis();
        return;
      }
      onHistoryHoverMove?.(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    [
      holdChartYAxis,
      notePointerMove,
      onHistoryHoverMove,
      onHistoryPointerMove,
      onLoudnessYRangeChange,
    ]
  );

  const onChartPointerUp = useCallback(
    (e) => {
      chartYDragRef.current = null;
      setChartDragging(false);
      releaseChartYAxis();
      onHistoryPointerUp?.(e);
    },
    [onHistoryPointerUp, releaseChartYAxis]
  );

  return (
    <div className="grid min-h-0 h-full grid-cols-[var(--ui-chart-y-axis-rail-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch">
      {/* Y-axis labels */}
      <AxisRail
        axis="y"
        inset
        className={cn(W_LOUDNESS_Y_AXIS, "min-h-0 shrink-0")}
        interaction={loudnessYAxis}
        active={chartYAxisActive}
        ticks={historyYAxisTicksLabeled.map(({ v, lb }) => ({
          key: v,
          label: lb,
          frac: loudnessFromTopFrac(v, loudnessYRange),
          className: v === targetLufs ? "font-semibold" : "",
        }))}
      />

      {/* Chart area */}
      <div
        ref={plotAreaRef}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1",
          !historyChartInteractive && "pointer-events-none"
        )}
        style={{
          cursor: historyChartInteractive
            ? chartDragging
              ? "grabbing"
              : isCtrlHover
                ? "grab"
                : "crosshair"
            : "default",
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          if (!historyChartInteractive) return;
          setSelectedOffset(-1);
          holdHistoryHud(false);
          showHistoryHud(1200);
        }}
        onWheel={onChartWheel}
        onPointerDown={onChartPointerDown}
        onPointerMove={onChartPointerMove}
        onPointerUp={onChartPointerUp}
        onPointerCancel={onChartPointerUp}
        onPointerLeave={(e) => {
          notePointerLeave(e);
          onHistoryHoverLeave?.(e);
        }}
      >
        {/* SVG paths + selection line */}
        <svg
          viewBox="0 0 600 220"
          preserveAspectRatio="none"
          className="relative z-[1] h-full w-full pt-[var(--ui-chart-inset-top)] pb-[var(--ui-chart-inset-bottom)]"
        >
          <defs>
            {mStops ? <RuleGradient id={mGradId} stops={mStops} /> : null}
            {stStops ? <RuleGradient id={stGradId} stops={stStops} /> : null}
          </defs>
          {showMomentary && displayHistoryPathM && (
            <path
              d={displayHistoryPathM}
              fill="none"
              stroke={mStops ? `url(#${mGradId})` : mStrokeNormal}
              strokeWidth="var(--ui-loudness-momentary-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showShortTerm && displayHistoryPathST && (
            <path
              d={displayHistoryPathST}
              fill="none"
              stroke={stStops ? `url(#${stGradId})` : stStrokeNormal}
              strokeWidth="var(--ui-loudness-shortterm-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Reference guide line: the profile's target loudness, drawn only when the `ref` layer
              is on. It judges nothing -- it is a place to aim the eye. */}
          {showReference && refTopFrac != null ? (
            <line
              data-testid="loudness-reference-line"
              x1={0}
              x2={600}
              y1={refTopFrac * 220}
              y2={refTopFrac * 220}
              stroke="var(--ui-loudness-reference)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          ) : null}
          {selectedOffset >= 0 && showSelLine ? (
            <line
              x1={selLineX}
              x2={selLineX}
              y1={0}
              y2={220}
              stroke="var(--ui-loudness-selection)"
              strokeWidth="var(--ui-loudness-selection-stroke-width)"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Overlays: hover crosshair and inspect HUD */}
        <div className="pointer-events-none absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)] z-10">
          <TimelineLatestEdgeHint active={showLatestEdgeHint} />
          <TimelineSelectionEdgeHint direction={selectionEdge} />
          {!hasSelectedLayer ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[length:var(--ui-fs-axis)] text-muted-foreground">
              No layers selected
            </div>
          ) : null}
          {historyHover?.leftPct != null ? (
            <div
              className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
              style={{ left: `${historyHover.leftPct}%` }}
            />
          ) : null}
          {historyHover?.topPct != null ? (
            <div
              className="absolute left-0 right-0 h-0 -translate-y-1/2 border-t border-dashed border-muted-foreground/40"
              style={{ top: `${historyHover.topPct}%` }}
            />
          ) : null}
          {historyHover ? (
            <div
              className={cn(
                "absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)]",
                LOUDNESS_HUD_BOX_POPOVER
              )}
            >
              <div>
                <span className={METRIC_NUMERIC}>{historyHover.offsetLabel}</span>
              </div>
              <div>
                M{" "}
                <span className={METRIC_NUMERIC}>
                  {historyHover.momentary != null
                    ? `${historyHover.momentary.toFixed(1)} LUFS`
                    : "-"}
                </span>
              </div>
              <div>
                ST{" "}
                <span className={METRIC_NUMERIC}>
                  {historyHover.shortTerm != null
                    ? `${historyHover.shortTerm.toFixed(1)} LUFS`
                    : "-"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div />
      <AxisRail
        axis="x"
        className="h-[var(--ui-chart-x-axis-row-h)]"
        interaction={timeAxisInteraction(historyTimeAxisHandlers)}
        active={isTimeAxisActive}
        ticks={historyTimeTicks.map((tick, i) => ({
          // Keyed by slot, not by text. A time label changes on almost every update, so a key
          // carrying it made React unmount and remount the tick instead of writing its text --
          // measured at 77 node mutations a second per panel, in three panels.
          key: i,
          label: tick,
          frac: i / historyTickSteps,
        }))}
      />
    </div>
  );
}
