import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { LOUDNESS_DB_MAX, LOUDNESS_DB_MIN, loudnessFromTopFrac } from "../../config/scales";
import { fmtSec } from "../../math/formatMath";

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

const LOUDNESS_HUD_BOX =
  "rounded border border-border bg-secondary px-2 py-0.5 text-[length:var(--ui-fs-axis)] text-muted-foreground";

const LOUDNESS_HUD_BOX_POPOVER =
  "rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm";

export function LoudnessHistoryChart({
  historyYAxisTicks,
  targetLufs,
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
  loudnessHistoryVisibleLayerIds = [],
  displayHistoryPathM,
  displayHistoryPathST,
  selectedOffset,
  showSelLine,
  selLineX,
  isHistoryHudVisible,
  clampedWindowSec,
  effectiveOffsetSec,
  historyHover,
  historyTimeTicks,
  historyTickSteps,
  referenceLufs,
  onHistoryHoverMove,
  onHistoryHoverLeave,
}) {
  const visibleLayerIds = Array.isArray(loudnessHistoryVisibleLayerIds)
    ? loudnessHistoryVisibleLayerIds
    : [];
  const showMomentary = visibleLayerIds.includes("momentary");
  const showShortTerm = visibleLayerIds.includes("shortTerm");
  const showReference = visibleLayerIds.includes("ref");
  const showReferenceLayer = showReference && Number.isFinite(referenceLufs);
  const hasSelectedLayer = showMomentary || showShortTerm || showReference;

  const historyYAxisTicksLabeled = useMemo(
    () => historyYAxisTicks.filter((t) => !(t.v === targetLufs && !hasHistoryData)),
    [historyYAxisTicks, targetLufs, hasHistoryData]
  );

  const referenceBandLu = 1;

  const reduceMotion = useReducedMotion();

  const historyGridRef = useRef(null);
  const [historyGridTopPx, setHistoryGridTopPx] = useState(() => ({}));

  useLayoutEffect(() => {
    const el = historyGridRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (!(h > 0)) return;
      const next = {};
      for (const { v } of historyYAxisTicksLabeled) {
        if (v === targetLufs && hasHistoryData) continue;
        const frac = loudnessFromTopFrac(v);
        const raw = Math.round(frac * h - 0.5);
        next[v] = Math.max(0, Math.min(h - 1, raw));
      }
      setHistoryGridTopPx(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [historyYAxisTicksLabeled, hasHistoryData, targetLufs]);

  return (
    <div className="grid min-h-0 h-full grid-cols-[var(--ui-w-loudness-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch">
      {/* Y-axis labels */}
      <div
        className={cn(
          W_LOUDNESS_Y_AXIS,
          "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
        )}
      >
        <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
          {historyYAxisTicksLabeled.map(({ v, lb }) => {
            const isTargetTick = v === targetLufs;
            const tickClass = isTargetTick
              ? "absolute right-0 leading-none font-semibold"
              : "absolute right-0 leading-none";
            if (v === LOUDNESS_DB_MAX) {
              return (
                <span key={v} className={`${tickClass} top-0`}>
                  {lb}
                </span>
              );
            }
            if (v === LOUDNESS_DB_MIN) {
              return (
                <span key={v} className={`${tickClass} bottom-0`}>
                  {lb}
                </span>
              );
            }
            return (
              <span
                key={v}
                className={`${tickClass} -translate-y-1/2`}
                style={{ top: `${loudnessFromTopFrac(v) * 100}%` }}
              >
                {lb}
              </span>
            );
          })}
        </div>
      </div>

      {/* Chart area */}
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 rounded-lg bg-muted",
          historyChartInteractive ? "cursor-crosshair" : "pointer-events-none"
        )}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          if (!historyChartInteractive) return;
          setSelectedOffset(-1);
          if (running) setStatus("Monitoring live input");
          holdHistoryHud(false);
          showHistoryHud(1200);
        }}
        onWheel={onHistoryWheel}
        onPointerDown={onHistoryPointerDown}
        onPointerMove={(e) => {
          onHistoryPointerMove(e);
          onHistoryHoverMove?.(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
        onPointerUp={onHistoryPointerUp}
        onPointerCancel={onHistoryPointerUp}
        onPointerLeave={onHistoryHoverLeave}
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
                className={`absolute left-0 right-0 h-px bg-[var(--ui-loudness-history-grid-line)]${topPx == null ? " -translate-y-1/2" : ""}`}
                style={
                  topPx == null
                    ? { top: `${loudnessFromTopFrac(v) * 100}%` }
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
          {showMomentary && displayHistoryPathM && (
            <path
              d={displayHistoryPathM}
              fill="none"
              stroke={
                selectedOffset >= 0 ? "var(--ui-chart-momentary-snap)" : "var(--ui-chart-momentary)"
              }
              strokeWidth="var(--ui-lh-stroke-m-w)"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showShortTerm && displayHistoryPathST && (
            <path
              d={displayHistoryPathST}
              fill="none"
              stroke={
                selectedOffset >= 0 ? "var(--ui-chart-shortterm-snap)" : "var(--ui-chart-shortterm)"
              }
              strokeWidth="var(--ui-lh-stroke-st-w)"
              opacity="var(--ui-lh-stroke-st-op)"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {selectedOffset >= 0 && showSelLine ? (
            <line
              x1={selLineX}
              x2={selLineX}
              y1={0}
              y2={220}
              stroke="var(--ui-chart-selection)"
              strokeWidth="var(--ui-lh-stroke-sel-w)"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Overlays: reference line, hover crosshair, HUD boxes */}
        <div className="pointer-events-none absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)] z-10">
          {showReferenceLayer ? (
            <>
              <div
                className="absolute left-0 right-0"
                style={{
                  top: `${loudnessFromTopFrac(referenceLufs + referenceBandLu) * 100}%`,
                  bottom: `${(1 - loudnessFromTopFrac(referenceLufs - referenceBandLu)) * 100}%`,
                  background: "color-mix(in srgb, var(--ui-chart-target-line) 12%, transparent)",
                }}
              />
              <motion.div
                className="absolute left-0 right-0 h-0 -translate-y-1/2 border-t border-dashed"
                initial={false}
                animate={{ top: `${loudnessFromTopFrac(referenceLufs) * 100}%` }}
                transition={
                  reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 32 }
                }
                style={{
                  borderTopColor: "var(--ui-chart-target-line)",
                  borderTopWidth: 2,
                }}
              />
            </>
          ) : null}
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
          {isHistoryHudVisible && (
            <div
              className={cn(
                "absolute bottom-[var(--ui-chart-hud-inset)] right-[var(--ui-chart-hud-inset)]",
                LOUDNESS_HUD_BOX
              )}
            >
              <span className={METRIC_NUMERIC}>Window {fmtSec(clampedWindowSec)}</span>
              {" | "}
              <span className={METRIC_NUMERIC}>Offset {fmtSec(effectiveOffsetSec)}</span>
            </div>
          )}
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
      <div className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)]")}>
        <div className="absolute inset-0">
          {historyTimeTicks.map((tick, i) => {
            if (i === 0) {
              return (
                <span key={`${i}-${tick}`} className="absolute left-0 top-0 text-left">
                  {tick}
                </span>
              );
            }
            if (i === historyTickSteps) {
              return (
                <span key={`${i}-${tick}`} className="absolute right-0 top-0 text-right">
                  {tick}
                </span>
              );
            }
            return (
              <span
                key={`${i}-${tick}`}
                className="absolute top-0 -translate-x-1/2 text-center"
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
