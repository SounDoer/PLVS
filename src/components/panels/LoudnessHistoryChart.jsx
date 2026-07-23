import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import { loudnessTraceGradientStops } from "@/lib/loudnessTraceColor.js";
import { RuleGradient } from "./LoudnessRuleGradient.jsx";
import { buildAdaptiveDbTicks, loudnessFromTopFrac } from "../../config/scales";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";
import {
  computeLinearPan,
  computeLinearZoom,
  pixelToLinearValue,
} from "../../math/axisInteractionMath.js";

const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
const ACTIVE_PULSE_MS = 160;

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

const LOUDNESS_HUD_BOX_POPOVER =
  "rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm";

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
    absMin: -64,
    absMax: 0,
    defaultMin: -64,
    defaultMax: 0,
    minSpan: 12,
    scale: "linear",
    onRangeChange: onLoudnessYRangeChange,
  });
  const chartActiveTimerRef = useRef(null);
  const [chartYAxisActive, setChartYAxisActive] = useState(false);
  const pulseChartYAxis = useCallback(() => {
    setChartYAxisActive(true);
    if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    chartActiveTimerRef.current = window.setTimeout(() => {
      chartActiveTimerRef.current = null;
      setChartYAxisActive(false);
    }, ACTIVE_PULSE_MS);
  }, []);
  useEffect(
    () => () => {
      if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    },
    []
  );
  const onChartWheel = useCallback(
    (e) => {
      if (!e.ctrlKey || typeof onLoudnessYRangeChange !== "function") {
        onHistoryWheel?.(e);
        return;
      }
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const height = Math.max(1, rect.height);
      const px = Math.max(0, Math.min(height, e.clientY - rect.top));
      const next = computeLinearZoom({
        min: loudnessYMinDb,
        max: loudnessYMaxDb,
        absMin: -64,
        absMax: 0,
        minSpan: 12,
        anchor: pixelToLinearValue(px, height, loudnessYMinDb, loudnessYMaxDb),
        factor: e.deltaY > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR,
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

  const historyGridRef = useRef(null);
  const [historyGridTopPx, setHistoryGridTopPx] = useState(() => ({}));

  const onChartPointerDown = useCallback(
    (e) => {
      if (e.ctrlKey && e.button === 0 && typeof onLoudnessYRangeChange === "function") {
        chartYDragRef.current = {
          startY: e.clientY,
          min: loudnessYMinDb,
          max: loudnessYMaxDb,
        };
        setChartDragging(true);
        if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
        setChartYAxisActive(true);
      }
      onHistoryPointerDown?.(e);
    },
    [loudnessYMaxDb, loudnessYMinDb, onHistoryPointerDown, onLoudnessYRangeChange]
  );

  const onChartPointerMove = useCallback(
    (e) => {
      notePointerMove(e);
      onHistoryPointerMove?.(e);
      const drag = chartYDragRef.current;
      if (drag && typeof onLoudnessYRangeChange === "function") {
        const rect = e.currentTarget.getBoundingClientRect();
        const next = computeLinearPan({
          min: drag.min,
          max: drag.max,
          absMin: -64,
          absMax: 0,
          deltaPx: e.clientY - drag.startY,
          axisPx: Math.max(1, rect.height),
        });
        onLoudnessYRangeChange(next.min, next.max);
        setChartYAxisActive(true);
        return;
      }
      onHistoryHoverMove?.(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    [onHistoryHoverMove, onHistoryPointerMove, onLoudnessYRangeChange]
  );

  const onChartPointerUp = useCallback(
    (e) => {
      chartYDragRef.current = null;
      setChartDragging(false);
      setChartYAxisActive(false);
      onHistoryPointerUp?.(e);
    },
    [onHistoryPointerUp]
  );

  useLayoutEffect(() => {
    const el = historyGridRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (!(h > 0)) return;
      const next = {};
      for (const { v } of historyYAxisTicksLabeled) {
        if (v === targetLufs && hasHistoryData) continue;
        const frac = loudnessFromTopFrac(v, loudnessYRange);
        const raw = Math.round(frac * h - 0.5);
        next[v] = Math.max(0, Math.min(h - 1, raw));
      }
      setHistoryGridTopPx((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((key) => prev[key] === next[key])
        ) {
          return prev;
        }
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [historyYAxisTicksLabeled, hasHistoryData, loudnessYMinDb, loudnessYMaxDb, targetLufs]);

  return (
    <div className="grid min-h-0 h-full grid-cols-[var(--ui-chart-y-axis-rail-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch">
      {/* Y-axis labels */}
      <div
        ref={loudnessYAxis.axisRef}
        {...loudnessYAxis.axisHandlers}
        style={{ cursor: loudnessYAxis.cursorStyle }}
        className={cn(
          W_LOUDNESS_Y_AXIS,
          "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
          (loudnessYAxis.isActive || chartYAxisActive) && "text-foreground"
        )}
      >
        <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
          {historyYAxisTicksLabeled.map(({ v, lb }, i) => {
            const isTargetTick = v === targetLufs;
            const tickClassExtra = isTargetTick ? "font-semibold" : "";
            if (i === 0) {
              return (
                <span key={v} className={axisLabelClass("y", "start", tickClassExtra)}>
                  {lb}
                </span>
              );
            }
            if (i === historyYAxisTicksLabeled.length - 1) {
              return (
                <span key={v} className={axisLabelClass("y", "end", tickClassExtra)}>
                  {lb}
                </span>
              );
            }
            return (
              <span
                key={v}
                className={axisLabelClass("y", "middle", tickClassExtra)}
                style={{ top: `${loudnessFromTopFrac(v, loudnessYRange) * 100}%` }}
              >
                {lb}
              </span>
            );
          })}
        </div>
      </div>

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
        {/* Horizontal grid lines */}
        <div
          ref={historyGridRef}
          className="pointer-events-none absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)] z-0"
        >
          {historyYAxisTicksLabeled.map(({ v }) => {
            if (v === targetLufs && hasHistoryData) return null;
            const topPx = historyGridTopPx[v];
            return (
              <div
                key={`hist-grid-${v}`}
                className={`absolute left-0 right-0 h-px bg-[var(--ui-loudness-grid)]${topPx == null ? " -translate-y-1/2" : ""}`}
                style={
                  topPx == null
                    ? { top: `${loudnessFromTopFrac(v, loudnessYRange) * 100}%` }
                    : { top: `${topPx}px` }
                }
              />
            );
          })}
        </div>

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
              stroke="var(--foreground)"
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
      <div
        {...(historyTimeAxisHandlers ?? {})}
        style={{ cursor: historyTimeAxisHandlers ? "ew-resize" : undefined }}
        className={cn(
          CAPTION_TEXT,
          "relative h-[var(--ui-chart-x-axis-row-h)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
          isTimeAxisActive && "text-foreground"
        )}
      >
        <div className="absolute inset-0">
          {historyTimeTicks.map((tick, i) => {
            if (i === 0) {
              return (
                <span key={`${i}-${tick}`} className={axisLabelClass("x", "start")}>
                  {tick}
                </span>
              );
            }
            if (i === historyTickSteps) {
              return (
                <span key={`${i}-${tick}`} className={axisLabelClass("x", "end")}>
                  {tick}
                </span>
              );
            }
            return (
              <span
                key={`${i}-${tick}`}
                className={axisLabelClass("x", "middle")}
                style={{ left: `${(i / historyTickSteps) * 100}%` }}
              >
                {tick}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
