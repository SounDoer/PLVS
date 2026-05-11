import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LOUDNESS_DB_MAX, LOUDNESS_DB_MIN, loudnessFromTopFrac } from "../../scales";
import { UI_PREFERENCES } from "../../uiPreferences";
import { fmtSec } from "../../math/formatMath";
import { HelpPopover } from "../HelpPopover";

const LOUDNESS_HELP = [
  "Left click - Select snapshot",
  "Left drag - Scrub timeline",
  "Left double-click - Return to live",
  "Right drag - Pan timeline",
  "Right double-click - Reset window and offset",
  "Mouse wheel - Wheel up/down to zoom in/out",
  "Click M / ST labels - Toggle curves",
];

function MetricRow({ label, value, unit, isActive = false, onToggle }) {
  const { valueColumnCh, unitColumnRem } = UI_PREFERENCES.modules.loudness.metrics;
  const content = (
    <>
      <span className="ui-metric-label">{label}</span>
      <span className="ui-metric-value" style={{ width: `${valueColumnCh}ch` }}>
        {value}
      </span>
      <span className="ui-metric-unit" style={{ width: `${unitColumnRem}rem` }}>
        {unit}
      </span>
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={isActive ? "ui-metric-row ui-metric-row-toggle on" : "ui-metric-row ui-metric-row-toggle"}
      >
        {content}
      </button>
    );
  }

  return <div className="ui-metric-row">{content}</div>;
}

export function LoudnessPanel({
  loudnessHistWidthRatio,
  historyYAxisTicks,
  targetLufs,
  referenceProfile,
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
  histCurves,
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
  primaryMetrics,
  secondaryMetrics,
  toggleCurve,
  onHistoryHoverMove,
  onHistoryHoverLeave,
}) {
  /** Must match the left-axis ticks actually drawn; change tick list or hide rules here only—grid follows */
  const historyYAxisTicksLabeled = useMemo(
    () => historyYAxisTicks.filter((t) => !(t.v === targetLufs && !hasHistoryData)),
    [historyYAxisTicks, targetLufs, hasHistoryData]
  );

  const referenceLufs = Number.isFinite(referenceProfile?.targetLufs) ? referenceProfile.targetLufs : null;
  const referenceBandLu = 1;

  const reduceMotion = useReducedMotion();
  const selSpring = useSpring(selLineX, {
    stiffness: reduceMotion ? 20000 : 540,
    damping: reduceMotion ? 200 : 46,
    mass: reduceMotion ? 0.06 : 0.28,
  });
  useEffect(() => {
    selSpring.set(selLineX);
  }, [selLineX, selSpring]);

  const historyGridRef = useRef(null);
  /** Per-tick horizontal guide line top (px), full container height on whole pixels to reduce subpixel AA banding */
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
    <Card
      className={cn(
        "ui-min-h-history flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-card)] border-border/80 bg-card/55 py-[var(--ui-article-pad-y)] pl-[var(--ui-article-pad-x)] pr-[var(--ui-article-pad-x)] text-card-foreground shadow-sm backdrop-blur-md",
      )}
    >
      <CardHeader className="flex shrink-0 flex-row items-center gap-2 space-y-0 p-0 pb-0">
        <CardTitle className="ui-section-title ui-section-title-main min-w-0 shrink-0 text-[length:var(--ui-fs-section)] font-semibold text-muted-foreground">
          Loudness
        </CardTitle>
        <HelpPopover items={LOUDNESS_HELP} />
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-section-title-gap)]">
      <div
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[var(--hmSplit)_minmax(0,1fr)] gap-x-[var(--ui-loudness-gap)]"
        style={{ "--hmSplit": `${Math.round(loudnessHistWidthRatio * 100)}%` }}
      >
        <div className="min-h-0 min-w-0">
          <div className="grid min-h-0 h-full grid-cols-[var(--ui-w-loudness-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)_auto] gap-x-[var(--ui-axis-gap-y)] gap-y-[var(--ui-axis-gap-x)] items-stretch ui-min-h-history">
            <div className="ui-w-loudness-y-axis relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis-value)] text-[color:var(--ui-color-text-muted)]">
              <div className="absolute inset-x-0 top-[var(--ui-history-display-top-inset)] bottom-[var(--ui-history-display-bottom-inset)]">
                {historyYAxisTicksLabeled.map(({ v, lb }) => {
                  const isTargetTick = v === targetLufs;
                  const tickClass = isTargetTick
                    ? "absolute right-0 leading-none font-semibold text-[color:var(--ui-color-target-value)]"
                    : "absolute right-0 leading-none";
                  /* Top/bottom: nudge labels inward so -50% translate does not collide with title or clip rounded corners; mid ticks share y with guides */
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
                    <span key={v} className={`${tickClass} -translate-y-1/2`} style={{ top: `${loudnessFromTopFrac(v) * 100}%` }}>
                      {lb}
                    </span>
                  );
                })}
              </div>
            </div>
            <div
              className={`ui-inset-chart relative min-h-0 min-w-0 rounded-lg bg-[var(--ui-color-inset-bg)]${historyChartInteractive ? "" : " pointer-events-none"}`}
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
              <div
                ref={historyGridRef}
                className="pointer-events-none absolute inset-x-[var(--ui-history-svg-pad)] top-[var(--ui-history-display-top-inset)] bottom-[var(--ui-history-display-bottom-inset)] z-0"
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
              <svg
                viewBox="0 0 600 220"
                preserveAspectRatio="none"
                className="relative z-[1] h-full w-full px-[var(--ui-history-svg-pad)] pt-[var(--ui-history-display-top-inset)] pb-[var(--ui-history-display-bottom-inset)]"
              >
                {histCurves.m && displayHistoryPathM && (
                  <path
                    d={displayHistoryPathM}
                    fill="none"
                    stroke={selectedOffset >= 0 ? "var(--ui-chart-momentary-snap)" : "var(--ui-chart-momentary)"}
                    strokeWidth={UI_PREFERENCES.modules.loudness.charts.loudnessHistory.momentaryStrokeWidth}
                  />
                )}
                {histCurves.st && displayHistoryPathST && (
                  <path
                    d={displayHistoryPathST}
                    fill="none"
                    stroke={selectedOffset >= 0 ? "var(--ui-chart-shortterm-snap)" : "var(--ui-chart-shortterm)"}
                    strokeWidth={UI_PREFERENCES.modules.loudness.charts.loudnessHistory.shortTermStrokeWidth}
                    opacity={UI_PREFERENCES.modules.loudness.charts.loudnessHistory.shortTermOpacity}
                  />
                )}
                {selectedOffset >= 0 && showSelLine ? (
                  <motion.line
                    x1={selSpring}
                    x2={selSpring}
                    y1={0}
                    y2={220}
                    stroke="var(--ui-chart-selection)"
                    strokeWidth={UI_PREFERENCES.modules.loudness.charts.loudnessHistory.selectionStrokeWidth}
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              <div className="pointer-events-none absolute inset-x-[var(--ui-history-svg-pad)] top-[var(--ui-history-display-top-inset)] bottom-[var(--ui-history-display-bottom-inset)] z-10">
                {referenceLufs != null ? (
                  <>
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        top: `${loudnessFromTopFrac(referenceLufs + referenceBandLu) * 100}%`,
                        bottom: `${(1 - loudnessFromTopFrac(referenceLufs - referenceBandLu)) * 100}%`,
                        background: "color-mix(in srgb, var(--ui-color-loudness-target-line) 12%, transparent)",
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
                        borderTopColor: "var(--ui-color-loudness-target-line)",
                        borderTopWidth: 2,
                      }}
                    />
                    <div
                      className="absolute left-[var(--ui-hud-inset)] bottom-[var(--ui-hud-inset)] rounded border border-[color:var(--ui-color-divider)] bg-[color:var(--ui-color-panel-bg-splitter)] px-2 py-0.5 text-[length:var(--ui-fs-axis-value)] text-[color:var(--ui-color-text-secondary)]"
                      style={{ opacity: 0.9 }}
                    >
                      Ref {referenceProfile?.label ?? `${referenceLufs} LUFS`}
                    </div>
                  </>
                ) : null}
                {historyHover?.leftPct != null ? (
                  <div
                    className="absolute bottom-0 top-0 border-l border-dashed border-[color:color-mix(in_srgb,var(--ui-color-text-secondary)_55%,transparent)]"
                    style={{ left: `${historyHover.leftPct}%` }}
                  />
                ) : null}
                {historyHover?.topPct != null ? (
                  <div
                    className="absolute left-0 right-0 h-0 -translate-y-1/2 border-t border-dashed border-[color:color-mix(in_srgb,var(--ui-color-text-secondary)_38%,transparent)]"
                    style={{ top: `${historyHover.topPct}%` }}
                  />
                ) : null}
                {isHistoryHudVisible && (
                  <div className="absolute bottom-[var(--ui-hud-inset)] right-[var(--ui-hud-inset)] rounded border border-[color:var(--ui-color-divider)] bg-[color:var(--ui-color-panel-bg-splitter)] px-2 py-0.5 text-[length:var(--ui-fs-axis-value)] text-[color:var(--ui-color-text-secondary)]">
                    <span className="ui-numeric">Window {fmtSec(clampedWindowSec)}</span>
                    {" | "}
                    <span className="ui-numeric">Offset {fmtSec(effectiveOffsetSec)}</span>
                  </div>
                )}
                {historyHover ? (
                  <div className="absolute left-[var(--ui-hud-inset)] top-[var(--ui-hud-inset)] rounded border border-[color:var(--ui-color-divider)] bg-[color:var(--ui-color-panel-bg-splitter)] px-2 py-1 text-[length:var(--ui-fs-axis-value)] text-[color:var(--ui-color-text-secondary)] shadow-sm">
                    <div>{historyHover.offsetLabel}</div>
                    <div>
                      M{" "}
                      <span className="ui-numeric">
                        {historyHover.momentary != null ? `${historyHover.momentary.toFixed(1)} LUFS` : "-"}
                      </span>
                    </div>
                    <div>
                      ST{" "}
                      <span className="ui-numeric">
                        {historyHover.shortTerm != null ? `${historyHover.shortTerm.toFixed(1)} LUFS` : "-"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div />
            <div className="ui-caption relative h-[var(--ui-chart-x-axis-row-h)]">
              <div className="absolute inset-x-[var(--ui-history-svg-pad)] top-0 h-full">
                {historyTimeTicks.map((tick, i) => {
                  if (i === 0) {
                    return <span key={`${i}-${tick}`} className="absolute left-0 top-0 text-left">{tick}</span>;
                  }
                  if (i === historyTickSteps) {
                    return <span key={`${i}-${tick}`} className="absolute right-0 top-0 text-right">{tick}</span>;
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

            <div className="h-0 shrink-0" />
            <div />
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex flex-col">
          <div className="ui-metrics-list flex min-h-0 flex-1 flex-col gap-[var(--ui-metrics-list-gap)] overflow-y-auto">
            {primaryMetrics.map((metric) => {
              if (metric.label === "Momentary") {
                return (
                  <MetricRow
                    key={metric.label}
                    {...metric}
                    isActive={histCurves.m}
                    onToggle={() => toggleCurve("m")}
                  />
                );
              }
              if (metric.label === "Short-term") {
                return (
                  <MetricRow
                    key={metric.label}
                    {...metric}
                    isActive={histCurves.st}
                    onToggle={() => toggleCurve("st")}
                  />
                );
              }
              return <MetricRow key={metric.label} {...metric} />;
            })}
            {secondaryMetrics.map((metric) => (
              <MetricRow key={metric.label} {...metric} />
            ))}
          </div>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}
