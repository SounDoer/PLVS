import { useMetricsData } from "../../workspace/AudioDataContext.jsx";
import { normalizeDockStatsIds } from "../dockLayout.js";
import { STATS_META } from "../../lib/statsCatalog.js";

/**
 * User-picked compact readouts from the shared stats catalog. Reads the
 * selection straight from the persisted dock state: the strip re-renders at
 * frame rate anyway (metrics context), so no dedicated subscription is
 * needed, and the picker (modules editor) writes through useDockLayout.
 */
export function DockStats({ controls }) {
  const { statsMetrics } = useMetricsData() ?? {};
  const statsIds = normalizeDockStatsIds(controls?.ids);
  const byId = new Map((statsMetrics ?? []).map((m) => [m.id, m]));
  return (
    <div className="flex h-full min-w-0 items-center gap-3 px-2">
      {statsIds.map((id) => {
        const metric = byId.get(id);
        const meta = STATS_META[id];
        return (
          <div key={id} data-testid="dock-stat" className="flex min-w-0 flex-col justify-center">
            <span className="truncate text-[8px] font-bold uppercase tracking-wide text-muted-foreground">
              {metric?.shortLabel ?? meta?.shortLabel ?? id}
            </span>
            <span className="font-[family-name:var(--ui-font-mono)] text-[12px] font-semibold leading-tight tabular-nums text-foreground">
              {metric?.value ?? "-"}
              {metric?.unit ? (
                <span className="ml-0.5 text-[7px] font-normal text-muted-foreground">
                  {metric.unit}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
