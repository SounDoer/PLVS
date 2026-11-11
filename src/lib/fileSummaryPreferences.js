import { DEFAULT_FILE_METRIC_IDS, FILE_METRICS } from "./fileAnalysisMeasurements.js";

const ALL_IDS = FILE_METRICS.map(({ id }) => id);
function validIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.filter((id) => ALL_IDS.includes(id)))] : [];
}

export function normalizeFileSummaryMetrics(value) {
  const order = [...new Set([...validIds(value?.order), ...ALL_IDS])];
  const visible = new Set(
    Array.isArray(value?.visible) ? validIds(value.visible) : DEFAULT_FILE_METRIC_IDS
  );
  return { order, visible: order.filter((id) => visible.has(id)) };
}

export function fitFileMetrics(width, widths, gap, overflowWidth) {
  if (
    widths.reduce((total, item) => total + item, 0) + Math.max(0, widths.length - 1) * gap <=
    width
  )
    return widths.length;
  let used = overflowWidth;
  for (let i = 0; i < widths.length; i++) {
    used += widths[i] + gap;
    if (used > width) return i;
  }
  return widths.length;
}
