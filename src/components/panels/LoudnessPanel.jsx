import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { METRICS_LIST_PAD, PANEL_MIN_HISTORY } from "@/lib/shellLayout";
import { UI_PREFERENCES } from "../../uiPreferences";
import { HelpPopover } from "../HelpPopover";
import { LoudnessHistoryChart } from "./LoudnessHistoryChart";

const LOUDNESS_HELP = [
  "Left click - Select snapshot",
  "Left drag - Scrub timeline",
  "Left double-click - Return to live",
  "Right drag - Pan timeline",
  "Right double-click - Reset window and offset",
  "Mouse wheel - Wheel up/down to zoom in/out",
  "Click M / ST labels - Toggle curves",
];

const METRIC_ROW_LAYOUT =
  "flex min-h-[var(--ui-metric-row-min-h)] items-center gap-[var(--ui-metric-row-gap)] rounded-[var(--ui-radius-metric-row)] px-[var(--ui-metric-row-pad-x)] py-[var(--ui-metric-row-pad-y)]";

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

function MetricRow({ label, value, unit, isActive = false, onToggle }) {
  const { valueColumnCh, unitColumnRem } = UI_PREFERENCES.modules.loudness.metrics;
  const labelClass = cn(
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[length:var(--ui-fs-metric-meta)] font-medium uppercase tracking-wide leading-none text-muted-foreground",
    onToggle && isActive && "text-[color:var(--ui-color-metric-toggle-on-label)]"
  );
  const valueClass = cn(
    METRIC_NUMERIC,
    "shrink-0 text-right text-[length:var(--ui-fs-metric-value)] font-semibold leading-none text-foreground"
  );
  const unitClass = cn(
    "shrink-0 text-right text-[length:var(--ui-fs-metric-meta)] font-medium uppercase leading-none text-muted-foreground",
    onToggle && isActive && "text-[color:var(--ui-color-metric-toggle-on-unit)]"
  );
  const content = (
    <>
      <span className={labelClass}>{label}</span>
      <span className={valueClass} style={{ width: `${valueColumnCh}ch` }}>
        {value}
      </span>
      <span className={unitClass} style={{ width: `${unitColumnRem}rem` }}>
        {unit}
      </span>
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        aria-pressed={isActive}
        onClick={onToggle}
        className={cn(
          METRIC_ROW_LAYOUT,
          "w-full cursor-pointer text-left appearance-none [-webkit-appearance:none]",
          "rounded-[var(--ui-radius-pill)] border border-border bg-[color:var(--ui-color-metric-row-bg)]",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
          "hover:bg-[color:var(--ui-color-metric-row-hover-bg)]",
          "hover:border-[color:color-mix(in_srgb,var(--border)_72%,var(--primary)_28%)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]",
          isActive &&
            "border-[color:var(--ui-color-metric-row-toggle-on-border)] bg-[color:var(--ui-color-metric-row-toggle-on-bg)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--ui-color-metric-row-toggle-on-border)_28%,transparent),0_0_12px_var(--ui-color-metric-row-toggle-on-glow)]"
        )}
      >
        {content}
      </button>
    );
  }

  return <div className={METRIC_ROW_LAYOUT}>{content}</div>;
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
  return (
    <Card
      className={cn(
        PANEL_MIN_HISTORY,
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius)] border-border/80 bg-card/55 py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)] text-card-foreground shadow-sm backdrop-blur-md"
      )}
    >
      <CardHeader className="flex shrink-0 flex-row items-center gap-2 space-y-0 p-0 pb-0">
        <CardTitle className="min-w-0 shrink-0 text-[length:var(--ui-fs-panel-title)] font-semibold text-muted-foreground">
          Loudness
        </CardTitle>
        <HelpPopover items={LOUDNESS_HELP} />
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-panel-title-gap)]">
        <div
          className="grid min-h-0 min-w-0 flex-1 grid-cols-[var(--hmSplit)_minmax(0,1fr)] gap-x-[var(--ui-loudness-gap)]"
          style={{ "--hmSplit": `${Math.round(loudnessHistWidthRatio * 100)}%` }}
        >
          <div className="min-h-0 min-w-0">
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
              histCurves={histCurves}
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
              referenceProfile={referenceProfile}
              onHistoryHoverMove={onHistoryHoverMove}
              onHistoryHoverLeave={onHistoryHoverLeave}
            />
          </div>

          <div className="min-h-0 min-w-0 flex flex-col">
            <div
              className={cn(
                METRICS_LIST_PAD,
                "flex min-h-0 flex-1 flex-col gap-[var(--ui-metric-list-gap)] overflow-y-auto"
              )}
            >
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
