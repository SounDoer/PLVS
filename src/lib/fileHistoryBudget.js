/** Retained-storage estimate, not process RSS. Count backing buffers once across shared views. */
export function estimateRetainedBytes(roots, seen = new WeakSet()) {
  const visit = (value) => {
    if (typeof value === "string") return value.length * 2;
    if (!value || typeof value !== "object" || seen.has(value)) return 0;
    seen.add(value);
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return 32 + visit(value.buffer);
    if (value instanceof Map) {
      let size = 48 + value.size * 24;
      for (const [key, child] of value) size += visit(key) + visit(child);
      return size;
    }
    if (value instanceof Set) {
      let size = 48 + value.size * 16;
      for (const child of value) size += visit(child);
      return size;
    }
    if (Array.isArray(value))
      return 32 + value.length * 8 + value.reduce((sum, child) => sum + visit(child), 0);
    const children = Object.values(value);
    return 32 + children.length * 16 + children.reduce((sum, child) => sum + visit(child), 0);
  };
  return roots.reduce((sum, root) => sum + visit(root), 0);
}

/** Internal retention target; protected/current histories may exceed it. See the validation note. */
export const FILE_HISTORY_BUDGET_BYTES = 256 * 1024 * 1024;

export function enforceFileHistoryBudget(
  history,
  budget = FILE_HISTORY_BUDGET_BYTES,
  protectedFileId = null
) {
  const eligible = history.order
    .filter(
      (id) =>
        id !== history.activeFileId &&
        id !== history.analyzingFileId &&
        id !== protectedFileId &&
        history.sessionsById[id].intake
    )
    .sort(
      (a, b) =>
        (history.sessionsById[a].lastViewedAt ?? history.sessionsById[a].createdAt ?? 0) -
        (history.sessionsById[b].lastViewedAt ?? history.sessionsById[b].createdAt ?? 0)
    );
  if (!eligible.length) return history;
  const eligibleIds = new Set(eligible);
  const seen = new WeakSet();
  const bytesFor = ({ intake, successfulResult, attempt }) =>
    estimateRetainedBytes([intake, successfulResult?.intake, attempt?.intake], seen);
  // Charge a shared allocation to its longest-retained owner so each graph is walked once.
  let bytes = history.order.reduce(
    (sum, id) => (eligibleIds.has(id) ? sum : sum + bytesFor(history.sessionsById[id])),
    0
  );
  const costs = new Map();
  for (const id of eligible.slice().reverse()) {
    const cost = bytesFor(history.sessionsById[id]);
    costs.set(id, cost);
    bytes += cost;
  }
  if (bytes <= budget) return history;
  const sessionsById = { ...history.sessionsById };
  for (const id of eligible) {
    const entry = sessionsById[id];
    const successfulResult = entry.successfulResult
      ? { ...entry.successfulResult, intake: null }
      : null;
    sessionsById[id] = {
      ...entry,
      intake: null,
      successfulResult,
      historyReleased: Boolean(entry.summary),
    };
    bytes -= costs.get(id);
    if (bytes <= budget) break;
  }
  return { ...history, sessionsById };
}
