import { cn } from "@/lib/utils";
import { UI_PREFERENCES } from "../../uiPreferences";
import {
  useFrameData,
  useMetricsData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { HoverTip } from "@/components/HoverTip";
import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";
import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";
import { watchedMetricIds } from "../../lib/loudnessProfileCatalog.js";
import { buildStatsValues } from "../../lib/statsCatalog.js";
import {
  loudnessLabelClass,
  loudnessStatusValueClass,
} from "../../lib/loudnessProfileStatusClasses.js";

const METRIC_ROW_LAYOUT =
  "flex min-h-[var(--ui-metric-row-min-h)] items-center gap-[var(--ui-metric-row-gap)] px-[var(--ui-metric-row-pad-x)]";

const METRIC_NUMERIC = "font-[family-name:var(--ui-font-mono)] tabular-nums";

function MetricRow({ id, label, shortLabel, value, unit, active, hint, status, watched }) {
  const { valueColumnCh, unitColumnRem } = UI_PREFERENCES.modules.stats.metrics;
  const labelClass = cn(
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[length:var(--ui-fs-metric-meta)] font-medium tracking-wide leading-tight",
    loudnessLabelClass(watched)
  );
  const valueClass = cn(
    METRIC_NUMERIC,
    "shrink-0 text-right text-[length:var(--ui-fs-metric-value)] font-semibold leading-none",
    loudnessStatusValueClass(status)
  );
  const unitClass =
    "@max-[180px]:hidden shrink-0 text-right text-[length:var(--ui-fs-metric-meta)] font-medium leading-none text-muted-foreground";
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
      <span className={labelClass}>
        <span className="@max-[240px]:hidden">{label}</span>
        <span className="hidden @max-[240px]:inline">{shortLabel ?? label}</span>
      </span>
      {/* data-stat-value: the one thing Stats and Dock Stats must agree on, addressable so a
          test can compare the two surfaces' colouring directly. */}
      <span data-stat-value={id} className={valueClass} style={{ width: `${valueColumnCh}ch` }}>
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
  const { statsMetrics, dialogueActiveNow } = useMetricsData();
  const { displayAudio } = useFrameData() ?? {};
  const { panelControls } = usePanelInstanceData();
  const { document: loudnessProfileDocument } = useLoudnessProfile();
  const statsVisibleIds = panelControls?.statsVisibleIds;
  const statsOrder = panelControls?.statsOrder;
  const visibleIds = Array.isArray(statsVisibleIds) ? statsVisibleIds : [];
  const allMetrics = Array.isArray(statsMetrics) ? statsMetrics : [];
  const metricById = new Map(allMetrics.map((metric) => [metric.id, metric]));
  const orderedMetrics = Array.isArray(statsOrder)
    ? statsOrder.map((id) => metricById.get(id)).filter(Boolean)
    : allMetrics;
  const visibleMetrics = orderedMetrics.filter((metric) => visibleIds.includes(metric.id));

  const values = displayAudio ? buildStatsValues(displayAudio) : {};
  const statuses = loudnessProfileEvaluate(loudnessProfileDocument, {
    values,
    integratedReady: Number.isFinite(values.integrated),
    dialogueCoverage: Number.isFinite(displayAudio?.dialoguePercent)
      ? displayAudio.dialoguePercent
      : null,
  });
  const watchedIds = new Set(watchedMetricIds(loudnessProfileDocument));

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--ui-metric-list-gap)] overflow-y-auto">
          {visibleMetrics.length > 0 ? (
            visibleMetrics.map((metric) => (
              <MetricRow
                key={metric.id}
                {...metric}
                status={statuses[metric.id]}
                watched={watchedIds.has(metric.id)}
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
