/**
 * Values outside this range are shown as "-". The negative floor doubles as a
 * display floor: a momentary / short-term reading at or below -100 LUFS is
 * effectively silence, so we collapse it to "-" rather than print a 6-char
 * value that would widen the metric column.
 */
export const METRIC_NEGATIVE_INFINITY_FLOOR = -100;
export const METRIC_POSITIVE_INFINITY_CEIL = 200;

export function fmtMetric(v) {
  if (!Number.isFinite(v)) return "-";
  if (v >= METRIC_POSITIVE_INFINITY_CEIL) return "-";
  // Compare the rounded (as-displayed) value so e.g. -99.96 -> "-100.0" is floored too.
  const r = Math.round(v * 10) / 10;
  if (r <= METRIC_NEGATIVE_INFINITY_FLOOR) return "-";
  return r.toFixed(1);
}
export function fmtSec(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs ? `${rs}s` : ""}`;
}
