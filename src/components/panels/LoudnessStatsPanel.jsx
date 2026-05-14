import { cn } from "@/lib/utils";
import { METRICS_LIST_PAD } from "@/lib/shellLayout";
import { UI_PREFERENCES } from "../../uiPreferences";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";

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

export function LoudnessStatsPanel({ compact = false }) {
  const { primaryMetrics, secondaryMetrics, histCurves, toggleCurve } = useAudioData();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
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
  );
}
