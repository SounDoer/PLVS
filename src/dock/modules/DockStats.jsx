import { useLayoutEffect, useRef, useState } from "react";
import { useMetricsData } from "../../workspace/AudioDataContext.jsx";
import { STATS_META, buildStatsValues } from "../../lib/statsCatalog.js";
import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";
import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";
import { watchedMetricIds } from "../../lib/loudnessProfileCatalog.js";
import {
  loudnessLabelClass,
  loudnessStatusValueClass,
} from "../../lib/loudnessProfileStatusClasses.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { normalizeDockModuleControls } from "../dockModuleControls.js";
import {
  fitDockStatsColumns,
  dockStatsGridPosition,
  dockStatsGridTemplate,
  DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX,
  DOCK_STATS_INNER_GAP_PX,
  visibleDockStats,
  dockStatsCellWidth,
} from "../dockStatsLayout.js";
import { useHoverTip } from "../../components/HoverTip.jsx";
import { DOCK_STATS_ROW_EXTRA_PX } from "../dockSizing.js";

const DOCK_TIP_CLASS = "w-max max-w-[calc(100vw-1rem)] whitespace-normal";

function useDockStatsColumnCount(containerRef, ids) {
  const idsKey = ids.join(",");
  const [layout, setLayout] = useState({
    columnCount: 1,
    cellWidth: DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX,
  });

  useLayoutEffect(() => {
    const element = containerRef.current;
    const selectedIds = idsKey ? idsKey.split(",") : [];
    if (!element || !selectedIds.length) return undefined;

    const measure = (width = element.clientWidth, height = element.clientHeight) => {
      const cellHeight = element
        .querySelector("[data-testid='dock-stat']")
        ?.getBoundingClientRect().height;
      const rowGap = parseFloat(getComputedStyle(element).rowGap) || 0;
      const minRowHeight = cellHeight > 0 ? cellHeight + rowGap : 18;
      const metricValue = parseFloat(getComputedStyle(element).fontSize) || 16;
      const label = element.querySelector("[data-testid='dock-stat-label']");
      const metricMeta = label ? parseFloat(getComputedStyle(label).fontSize) || 12 : 12;
      const cellWidth = dockStatsCellWidth({ metricValue, metricMeta }, selectedIds);
      // The first one-column pass can have a native vertical scrollbar. Fit against the width
      // available after it disappears, or its gutter can permanently prevent the final column.
      const availableWidth = width + Math.max(0, element.offsetWidth - element.clientWidth);
      const columnCount = fitDockStatsColumns(
        availableWidth,
        height,
        selectedIds.length,
        cellWidth,
        minRowHeight,
        rowGap
      );
      setLayout((current) =>
        current.columnCount === columnCount && current.cellWidth === cellWidth
          ? current
          : { columnCount, cellWidth }
      );
    };

    measure();
    const fontMeasure = () => measure();
    document.fonts?.addEventListener("loadingdone", fontMeasure);
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === element);
      measure(containerEntry?.contentRect?.width, containerEntry?.contentRect?.height);
    });
    observer.observe(element);
    const cell = element.querySelector("[data-testid='dock-stat']");
    if (cell) observer.observe(cell);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontMeasure);
    };
  }, [containerRef, idsKey]);

  return layout;
}

function DockStatCell({
  id,
  label,
  accessibleLabel,
  value,
  hint,
  dialogueActive,
  position,
  watched,
  status,
  showActivitySlot,
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: hint,
    side: "top",
    tipClassName: DOCK_TIP_CLASS,
  });

  return (
    <div
      ref={anchorRef}
      data-testid="dock-stat"
      className="flex min-w-0 items-center overflow-hidden"
      style={{
        gridColumn: position.cellColumn,
        gridRow: position.row,
        gap: `${DOCK_STATS_INNER_GAP_PX}px`,
        height: `calc(var(--ui-fs-metric-value) + ${DOCK_STATS_ROW_EXTRA_PX}px)`,
      }}
      aria-label={`${accessibleLabel} ${value}`}
      onMouseEnter={hint ? showTip : undefined}
      onMouseLeave={hint ? hideTip : undefined}
    >
      <span
        data-testid="dock-stat-label"
        data-loudness-watched={watched ? "true" : "false"}
        className={`flex min-w-0 flex-1 items-center gap-[var(--ui-dock-gap-column)] overflow-hidden font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-fs-metric-meta)] font-medium leading-normal ${loudnessLabelClass(watched)}`}
      >
        {showActivitySlot ? (
          <span className="flex w-1.5 shrink-0 items-center">
            {id === "dialogueCoverage" ? (
              <span
                data-testid="dock-dialogue-active-dot"
                data-active={dialogueActive ? "true" : "false"}
                className={`size-1.5 shrink-0 rounded-full border ${
                  dialogueActive
                    ? "border-foreground bg-foreground"
                    : "border-muted-foreground bg-transparent"
                }`}
              />
            ) : null}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span
        data-stat-value={id}
        data-loudness-status={status ?? "off"}
        className={`w-[var(--ui-dock-readout-w)] shrink-0 whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-metric-value)] font-semibold leading-none tabular-nums ${loudnessStatusValueClass(status)}`}
      >
        {value}
      </span>
      {tipNode}
    </div>
  );
}

/**
 * User-picked compact readouts from the shared stats catalog. Reads the
 * selection straight from the persisted dock state: the strip re-renders at
 * frame rate anyway (metrics context), so no dedicated subscription is
 * needed, and the picker (modules editor) writes through useDockLayout.
 */
export function DockStats({ controls }) {
  const { statsMetrics, dialogueActiveNow } = useMetricsData() ?? {};
  const { displayAudio } = useFrameData() ?? {};
  const { document: loudnessProfileDocument } = useLoudnessProfile();
  const normalizedControls = normalizeDockModuleControls("stats", controls);
  // The dock is a second implementation of Stats, so it has to evaluate too: the same metric
  // under the same profile must not read as a breach here and neutral in the normal window.
  const rawValues = displayAudio ? buildStatsValues(displayAudio) : {};
  const statuses = loudnessProfileEvaluate(loudnessProfileDocument, {
    values: rawValues,
    integratedReady: Number.isFinite(rawValues.integrated),
  });
  const watchedIds = new Set(watchedMetricIds(loudnessProfileDocument));
  const byId = new Map((statsMetrics ?? []).map((m) => [m.id, m]));
  const selected = new Set(normalizedControls.statsVisibleIds);
  const orderedMetrics = normalizedControls.statsOrder
    .filter((id) => selected.has(id))
    .map((id) => ({ id, metric: byId.get(id), meta: STATS_META[id] }));
  const containerRef = useRef(null);
  const { columnCount, cellWidth } = useDockStatsColumnCount(
    containerRef,
    orderedMetrics.map(({ id }) => id)
  );
  const visibleMetrics = visibleDockStats(orderedMetrics, columnCount);

  if (orderedMetrics.length === 0) {
    return (
      <div className="flex h-full min-w-0 items-center px-[var(--ui-dock-pad-x)] text-[length:var(--ui-fs-metric-meta)] font-medium text-muted-foreground">
        No stats selected
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      style={{ padding: "var(--ui-dock-pad-y) var(--ui-dock-pad-x)" }}
    >
      <div
        ref={containerRef}
        data-testid="dock-stats-grid"
        data-column-count={columnCount}
        className="grid min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden text-[length:var(--ui-fs-metric-value)]"
        style={{
          gridTemplateColumns: dockStatsGridTemplate(columnCount, cellWidth),
          gridTemplateRows: `repeat(${Math.ceil(visibleMetrics.length / columnCount)}, max-content)`,
          alignContent: "safe center",
          justifyContent: "center",
          rowGap: "var(--ui-dock-gap-row)",
        }}
      >
        {visibleMetrics.map(({ id, metric, meta }, metricIndex) => {
          const label = metric?.shortLabel ?? meta?.shortLabel ?? id;
          const value = metric?.value ?? "-";
          const dialogueActive = id === "dialogueCoverage" && dialogueActiveNow;
          const position = dockStatsGridPosition(metricIndex, columnCount);
          return (
            <DockStatCell
              key={id}
              id={id}
              label={label}
              accessibleLabel={meta?.label ?? label}
              value={value}
              hint={meta?.hint}
              dialogueActive={dialogueActive}
              position={position}
              watched={watchedIds.has(id)}
              status={statuses[id]}
              showActivitySlot={selected.has("dialogueCoverage")}
            />
          );
        })}
      </div>
    </div>
  );
}
