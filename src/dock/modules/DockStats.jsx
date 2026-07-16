import { useLayoutEffect, useRef, useState } from "react";
import { useMetricsData } from "../../workspace/AudioDataContext.jsx";
import { STATS_META } from "../../lib/statsCatalog.js";
import { normalizeDockModuleControls } from "../dockModuleControls.js";
import {
  computeDockStatsColumnCount,
  dockStatsGridPosition,
  dockStatsGridTemplate,
  DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX,
  DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX,
  DOCK_STATS_INNER_GAP_PX,
  DOCK_STATS_MIN_CELL_WIDTH_PX,
  visibleDockStats,
} from "../dockStatsLayout.js";
import { DockExpandedMetric } from "./DockExpandedMetric.jsx";

function useDockStatsColumnCount(containerRef, enabled, minCellWidth) {
  const [columnCount, setColumnCount] = useState(1);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return undefined;

    const measure = (width = element.clientWidth) => {
      const next = computeDockStatsColumnCount(width, undefined, minCellWidth);
      setColumnCount((current) => (current === next ? current : next));
    };

    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      measure(entries[0]?.contentRect?.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, enabled, minCellWidth]);

  return columnCount;
}

/**
 * User-picked compact readouts from the shared stats catalog. Reads the
 * selection straight from the persisted dock state: the strip re-renders at
 * frame rate anyway (metrics context), so no dedicated subscription is
 * needed, and the picker (modules editor) writes through useDockLayout.
 */
export function DockStats({ controls, heightMode = "standard" }) {
  const { statsMetrics, dialogueActiveNow } = useMetricsData() ?? {};
  const normalizedControls = normalizeDockModuleControls("stats", controls);
  const byId = new Map((statsMetrics ?? []).map((m) => [m.id, m]));
  const selected = new Set(normalizedControls.statsVisibleIds);
  const orderedMetrics = normalizedControls.statsOrder
    .filter((id) => selected.has(id))
    .map((id) => ({ id, metric: byId.get(id), meta: STATS_META[id] }));
  const containerRef = useRef(null);
  const expanded = heightMode === "expanded";
  const minCellWidth = expanded
    ? DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX
    : DOCK_STATS_MIN_CELL_WIDTH_PX;
  const columnCount = useDockStatsColumnCount(
    containerRef,
    orderedMetrics.length > 0,
    minCellWidth
  );
  const visibleMetrics = visibleDockStats(orderedMetrics, columnCount);

  if (orderedMetrics.length === 0) {
    return (
      <div className="flex h-full min-w-0 items-center px-[var(--ui-dock-pad-x)] text-[length:var(--ui-dock-fs-label)] font-medium text-muted-foreground">
        No stats selected
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-w-0"
      style={{ padding: "var(--ui-dock-pad-y) var(--ui-dock-pad-x)" }}
    >
      <div
        ref={containerRef}
        data-testid="dock-stats-grid"
        data-column-count={columnCount}
        className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{
          gridTemplateColumns: dockStatsGridTemplate(
            columnCount,
            expanded ? DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX : undefined
          ),
          gridTemplateRows: "repeat(3, max-content)",
          alignContent: "space-around",
          justifyContent: "center",
          rowGap: "var(--ui-dock-gap-row)",
        }}
      >
        {visibleMetrics.map(({ id, metric, meta }, metricIndex) => {
          const label = metric?.shortLabel ?? meta?.shortLabel ?? id;
          const value = metric?.value ?? "-";
          const unit = metric?.unit ?? meta?.unit ?? "";
          const dialogueActive = id === "dialogueCoverage" && dialogueActiveNow;
          const position = dockStatsGridPosition(metricIndex, columnCount);
          return (
            <div
              key={id}
              data-testid="dock-stat"
              className={expanded ? "min-w-0" : "flex min-w-0 items-baseline"}
              style={{
                gridColumn: position.cellColumn,
                gridRow: position.row,
                gap: `${DOCK_STATS_INNER_GAP_PX}px`,
              }}
              aria-label={`${meta?.label ?? label} ${value}`}
            >
              {expanded ? (
                <DockExpandedMetric
                  label={label}
                  value={value}
                  unit={unit}
                  unitVisibility="tight"
                  indicator={
                    id === "dialogueCoverage" ? (
                      <span
                        data-testid="dock-dialogue-active-dot"
                        data-active={dialogueActive ? "true" : "false"}
                        className={`size-1.5 shrink-0 rounded-full ${
                          dialogueActive ? "bg-foreground" : "bg-muted-foreground/30"
                        }`}
                      />
                    ) : null
                  }
                />
              ) : (
                <>
                  <span
                    data-testid="dock-stat-label"
                    title={label}
                    className="flex min-w-0 flex-1 items-center gap-[var(--ui-dock-gap-column)] overflow-hidden font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground"
                  >
                    {id === "dialogueCoverage" ? (
                      <span
                        data-testid="dock-dialogue-active-dot"
                        data-active={dialogueActive ? "true" : "false"}
                        className={`size-1.5 shrink-0 rounded-full ${
                          dialogueActive ? "bg-foreground" : "bg-muted-foreground/30"
                        }`}
                      />
                    ) : null}
                    <span className="min-w-0 truncate">{label}</span>
                  </span>
                  <span className="w-[var(--ui-dock-readout-w)] shrink-0 whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground">
                    {value}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
