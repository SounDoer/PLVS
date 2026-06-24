import { cn } from "@/lib/utils";
import { UI_PREFERENCES } from "../../uiPreferences";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { HoverTip } from "@/components/HoverTip";

const METRIC_ROW_LAYOUT =
  "flex min-h-[var(--ui-metric-row-min-h)] items-center gap-[var(--ui-metric-row-gap)] px-[var(--ui-metric-row-pad-x)]";

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

function MetricRow({ id, label, value, unit, active, hint }) {
  const { valueColumnCh, unitColumnRem } = UI_PREFERENCES.modules.stats.metrics;
  const labelClass =
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[length:var(--ui-fs-metric-meta)] font-medium tracking-wide leading-tight text-muted-foreground";
  const valueClass = cn(
    METRIC_NUMERIC,
    "shrink-0 text-right text-[length:var(--ui-fs-metric-value)] font-semibold leading-none text-foreground"
  );
  const unitClass =
    "@max-[200px]:hidden shrink-0 text-right text-[length:var(--ui-fs-metric-meta)] font-medium leading-none text-muted-foreground";
  const content = (
    <>
      {id === "dialogueCoverage" && (
        <span
          data-testid="dialogue-active-dot"
          data-active={active ? "true" : "false"}
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            active ? "bg-foreground" : "bg-muted-foreground/30"
          )}
        />
      )}
      <span className={labelClass}>{label}</span>
      <span className={valueClass} style={{ width: `${valueColumnCh}ch` }}>
        {value}
      </span>
      <span className={unitClass} style={{ width: `${unitColumnRem}rem` }}>
        {unit}
      </span>
    </>
  );

  return (
    <HoverTip tip={hint} tipClassName="whitespace-normal w-max max-w-[15rem]">
      <div className={METRIC_ROW_LAYOUT}>{content}</div>
    </HoverTip>
  );
}

export function StatsPanel() {
  const { statsMetrics, panelControls, dialogueActiveNow } = useAudioData();
  const statsVisibleIds = panelControls?.statsVisibleIds;
  const statsOrder = panelControls?.statsOrder;
  const visibleIds = Array.isArray(statsVisibleIds) ? statsVisibleIds : [];
  const allMetrics = Array.isArray(statsMetrics) ? statsMetrics : [];
  const metricById = new Map(allMetrics.map((metric) => [metric.id, metric]));
  const orderedMetrics = Array.isArray(statsOrder)
    ? statsOrder.map((id) => metricById.get(id)).filter(Boolean)
    : allMetrics;
  const visibleMetrics = orderedMetrics.filter((metric) => visibleIds.includes(metric.id));

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--ui-metric-list-gap)] overflow-y-auto">
          {visibleMetrics.length > 0 ? (
            visibleMetrics.map((metric) => (
              <MetricRow
                key={metric.id}
                {...metric}
                active={metric.id === "dialogueCoverage" && dialogueActiveNow}
              />
            ))
          ) : (
            <div className="px-[var(--ui-metric-row-pad-x)] text-[length:var(--ui-fs-metric-meta)] font-medium text-muted-foreground">
              No stats selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
