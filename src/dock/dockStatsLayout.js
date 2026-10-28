import { DOCK_PAD_X, DOCK_PAD_Y, DOCK_STATS_ROW_GAP, dockStatsRowHeight } from "./dockSizing.js";
import { STATS_META } from "../lib/statsCatalog.js";

// Fallback geometry before a layout is measured. Running panels pass selected-label measurements.
export const DOCK_STATS_MIN_CELL_WIDTH_PX = 84;
export const DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX = 92;
export const DOCK_STATS_INNER_GAP_PX = 2;
export const DOCK_STATS_GROUP_GAP_PX = 12;
export const DOCK_STATS_ACTIVITY_SLOT_PX = 10;
const measuredWidths = new Map();
const observedDocuments = new WeakSet();

/** Measure the selected labels once per layout; values always reserve five mono characters. */
export function dockStatsCellWidth(font, ids = Object.keys(STATS_META)) {
  const styles =
    typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const sans = styles?.getPropertyValue("--ui-font-sans").trim() || "Inter, sans-serif";
  const mono = styles?.getPropertyValue("--ui-font-mono").trim() || '"JetBrains Mono", monospace';
  const key = JSON.stringify([
    font.metricMeta,
    font.metricValue,
    sans,
    mono,
    ids,
    typeof document !== "undefined" ? document.fonts?.status : "fallback",
  ]);
  if (measuredWidths.has(key)) return measuredWidths.get(key);
  if (typeof document !== "undefined" && document.fonts && !observedDocuments.has(document)) {
    observedDocuments.add(document);
    document.fonts.addEventListener("loadingdone", () => measuredWidths.clear());
  }
  let context = null;
  if (typeof document !== "undefined" && typeof CanvasRenderingContext2D !== "undefined") {
    context = document.createElement("canvas").getContext("2d");
  }
  const measure = (text, size, weight, family) => {
    if (!context) return text.length * size * 0.65;
    context.font = `${weight} ${size}px ${family}`;
    return context.measureText(text).width;
  };
  const labelWidth = Math.max(
    0,
    ...ids.map((id) => measure(STATS_META[id]?.shortLabel ?? id, font.metricMeta, 500, sans))
  );
  if (ids.length === 0) {
    return Math.ceil(measure("No stats selected", font.metricMeta, 500, sans)) + 2;
  }
  const activityWidth = ids.includes("dialogueCoverage") ? DOCK_STATS_ACTIVITY_SLOT_PX : 0;
  const readoutWidth = 5 * measure("0", font.metricValue, 600, mono);
  const width = Math.ceil(labelWidth + activityWidth + DOCK_STATS_INNER_GAP_PX + readoutWidth + 2);
  if (measuredWidths.size > 256) measuredWidths.clear();
  measuredWidths.set(key, width);
  return width;
}

/** Reserve complete rows, selected labels and a shared numeric track without speculative clearance. */
export function recommendedDockStatsWidth(height, count, font, ids = Object.keys(STATS_META)) {
  const rows = Math.max(
    1,
    Math.floor(
      (height - 2 * DOCK_PAD_Y + DOCK_STATS_ROW_GAP) /
        (dockStatsRowHeight(font) + DOCK_STATS_ROW_GAP)
    )
  );
  const columns = Math.max(1, Math.ceil(count / rows));
  const cellWidth = dockStatsCellWidth(font, ids);
  return columns * cellWidth + (columns - 1) * DOCK_STATS_GROUP_GAP_PX + 2 * DOCK_PAD_X;
}

/**
 * @param {number} widthPx
 */
export function computeDockStatsColumnCount(
  widthPx,
  groupGapPx = DOCK_STATS_GROUP_GAP_PX,
  minCellWidthPx = DOCK_STATS_MIN_CELL_WIDTH_PX
) {
  const width = Number(widthPx);
  const groupGap = Number(groupGapPx);
  const minCellWidth = Number(minCellWidthPx);
  if (!Number.isFinite(width) || width <= 0) return 1;
  if (!Number.isFinite(groupGap) || groupGap < 0) return 1;
  if (!Number.isFinite(minCellWidth) || minCellWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + groupGap) / (minCellWidth + groupGap)));
}

/**
 * @param {number} _columnCount
 */
export function visibleDockStats(metrics, _columnCount) {
  return metrics;
}

/**
 * @param {number} metricIndex
 * @param {number} columnCount
 */
export function dockStatsGridPosition(metricIndex, columnCount) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  const index = Math.max(0, Math.floor(Number(metricIndex) || 0));
  const visualColumn = index % columns;
  return {
    row: Math.floor(index / columns) + 1,
    cellColumn: visualColumn * 2 + 1,
  };
}

/**
 * @param {number} columnCount
 */
export function dockStatsGridTemplate(
  columnCount,
  comfortableCellWidthPx = DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX
) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  const comfortableCellWidth = Number.isFinite(Number(comfortableCellWidthPx))
    ? Math.max(1, Number(comfortableCellWidthPx))
    : DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX;
  const metricTrack = `minmax(0, ${comfortableCellWidth}px)`;
  const groupGap = `minmax(${DOCK_STATS_GROUP_GAP_PX}px, 1fr)`;
  return Array.from({ length: columns }, (_, columnIndex) =>
    columnIndex < columns - 1 ? `${metricTrack} ${groupGap}` : metricTrack
  ).join(" ");
}

/** Fill the available width with readable columns; height only affects vertical overflow. */
export function fitDockStatsColumns(width, count, minCellWidth) {
  const maxColumns = computeDockStatsColumnCount(width, undefined, minCellWidth);
  return Math.min(maxColumns, Math.max(1, count));
}
