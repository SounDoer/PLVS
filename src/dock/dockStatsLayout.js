import { DOCK_PAD_X, DOCK_PAD_Y, DOCK_STATS_ROW_GAP } from "./dockSizing.js";

// Widths at a 13px value font, scaled by the rendered font. Single-line cells must hold the
// longest short label (7 characters, e.g. "Dlg Rng") beside a 5ch readout without truncation.
export const DOCK_STATS_MIN_CELL_WIDTH_PX = 84;
export const DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX = 92;
export const DOCK_STATS_INNER_GAP_PX = 2;
export const DOCK_STATS_GROUP_GAP_PX = 12;

/** Include scrollbar clearance so an initially overflowing grid can reach the fitted column count. */
export function recommendedDockStatsWidth(height, count, font) {
  const rows = Math.max(
    1,
    Math.floor(
      (height - 2 * DOCK_PAD_Y + DOCK_STATS_ROW_GAP) / (font.metricValue + DOCK_STATS_ROW_GAP)
    )
  );
  const columns = Math.max(1, Math.ceil(count / rows));
  const cellWidth = (DOCK_STATS_MIN_CELL_WIDTH_PX * font.metricValue) / 13;
  const width = columns * cellWidth + (columns - 1) * DOCK_STATS_GROUP_GAP_PX + 2 * DOCK_PAD_X + 24;
  return Math.max(Math.ceil((160 * font.metricValue) / 16), Math.ceil(width / 20) * 20);
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

/** Choose readable columns using both dimensions; overflow is handled by the scroll container. */
export function fitDockStatsColumns(width, height, count, minCellWidth, minRowHeight) {
  const maxColumns = computeDockStatsColumnCount(width, undefined, minCellWidth);
  const rows = Math.max(1, Math.floor(height / minRowHeight));
  return Math.min(maxColumns, Math.max(1, Math.ceil(count / rows)));
}
