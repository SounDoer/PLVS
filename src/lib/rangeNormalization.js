/**
 * Repairing a stored min/max pair, shared by the per-panel controls and by the shared viewport a
 * linked group navigates. It lives apart from both so that neither has to import the other: panel
 * controls own the control table, `workspace/axisViewports.js` owns the axis kinds, and each needs
 * a row from the other's world repaired the same way.
 */

export function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampNumber(raw, min, max, fallback) {
  if (!isNumber(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/** Reads a control's stored value, falling back to the keys it used to live under. */
export function readStored(raw, row) {
  let value = raw?.[row.key];
  for (const legacyKey of row.legacyKeys ?? []) {
    value = value ?? raw?.[legacyKey];
  }
  return value;
}

/**
 * Repairs a min/max pair together: each bound clamps to the row's absolute limits, then the pair
 * is opened up to the row's minimum span. Which bound moves depends on which one the caller
 * actually supplied -- a stored max with no min means the min is the one to move.
 * */
export function normalizeRange(row, raw) {
  const rawMin = readStored(raw, { key: row.minKey, legacyKeys: row.minLegacyKeys });
  const rawMax = readStored(raw, { key: row.maxKey, legacyKeys: row.maxLegacyKeys });
  const log = row.kind === "logRange";
  const round = (value) => (log ? value : Math.round(value));
  const openUp = (value) => (log ? value * 2 ** row.minSpan : value + row.minSpan);
  const openDown = (value) => (log ? value / 2 ** row.minSpan : value - row.minSpan);
  const tooNarrow = (min, max) =>
    log ? max <= min || Math.log2(max / min) < row.minSpan : max - min < row.minSpan;

  let min = round(clampNumber(rawMin, row.absMin, row.absMax, row.defaultMin));
  let max = round(clampNumber(rawMax, row.absMin, row.absMax, row.defaultMax));
  if (tooNarrow(min, max)) {
    if (isNumber(rawMax) && !isNumber(rawMin)) {
      min = Math.max(row.absMin, openDown(max));
    } else {
      max = Math.min(row.absMax, openUp(min));
      if (tooNarrow(min, max)) min = Math.max(row.absMin, openDown(max));
    }
  }
  return { [row.minKey]: min, [row.maxKey]: max };
}
