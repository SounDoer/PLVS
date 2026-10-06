/**
 * @param {any} list
 * @param {number} index
 */
function rowAt(list, index) {
  if (!list || list.length <= 0) return null;
  return typeof list.rowAt === "function" ? list.rowAt(index) : list[index];
}

/** @param {any} row */
function finiteTimestamp(row) {
  return Number.isFinite(row?.timestampMs) ? row.timestampMs : undefined;
}

/**
 * The oldest row's timestamp of a history list (a ring with `rowAt`, or an array).
 *
 * @param {any} list
 * @returns {number | undefined}
 */
export function firstHistoryTimestampMs(list) {
  return finiteTimestamp(rowAt(list, 0));
}

/**
 * The newest row's timestamp of a history list (a ring with `rowAt`, or an array).
 *
 * @param {any} list
 * @returns {number | undefined}
 */
export function latestHistoryTimestampMs(list) {
  return finiteTimestamp(rowAt(list, (list?.length ?? 0) - 1));
}
