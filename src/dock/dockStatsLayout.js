export const DOCK_STATS_MAX_ROWS = 3;
export const DOCK_STATS_MIN_CELL_WIDTH_PX = 60;
export const DOCK_STATS_COMFORTABLE_CELL_WIDTH_PX = 72;
export const DOCK_STATS_EXPANDED_MIN_CELL_WIDTH_PX = 64;
export const DOCK_STATS_EXPANDED_COMFORTABLE_CELL_WIDTH_PX = 84;
export const DOCK_STATS_INNER_GAP_PX = 2;
export const DOCK_STATS_GROUP_GAP_PX = 12;

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

export function visibleDockStats(metrics, columnCount) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  return metrics.slice(0, columns * DOCK_STATS_MAX_ROWS);
}

export function dockStatsGridPosition(metricIndex, columnCount) {
  const columns = Math.max(1, Math.floor(Number(columnCount) || 1));
  const index = Math.max(0, Math.floor(Number(metricIndex) || 0));
  const visualColumn = index % columns;
  return {
    row: Math.floor(index / columns) + 1,
    cellColumn: visualColumn * 2 + 1,
  };
}

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
