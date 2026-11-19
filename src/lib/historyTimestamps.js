import { rowAt } from "./historyRow.js";

/** @param {number} index */
export function historyTimestampAt(list, index) {
  if (!list || index < 0 || index >= list.length) return undefined;
  const ms =
    typeof list.timestampAt === "function"
      ? list.timestampAt(index)
      : rowAt(list, index)?.timestampMs;
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The oldest row's timestamp of a history list (a ring with `rowAt`, or an array).
 *
 * @param {any} list
 * @returns {number | undefined}
 */
export function firstHistoryTimestampMs(list) {
  return historyTimestampAt(list, 0);
}

/**
 * The newest row's timestamp of a history list (a ring with `rowAt`, or an array).
 *
 * @param {any} list
 * @returns {number | undefined}
 */
export function latestHistoryTimestampMs(list) {
  return historyTimestampAt(list, (list?.length ?? 0) - 1);
}
