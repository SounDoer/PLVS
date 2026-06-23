export const FILE_ANALYSIS_HISTORY_LIMIT = 5;

const ANALYSIS_COMPLETE_STATES = new Set(["complete", "error", "ready"]);

function generateFileSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `file-analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function basename(path) {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function createHistory({ sessionsById, order, activeFileId, analyzingFileId }) {
  return {
    sessionsById,
    order,
    activeFileId,
    analyzingFileId,
  };
}

function replaceEntry(history, id, entry) {
  return createHistory({
    ...history,
    sessionsById: {
      ...history.sessionsById,
      [id]: entry,
    },
  });
}

function removeEntryById(history, id) {
  const { [id]: _removed, ...sessionsById } = history.sessionsById;
  const order = history.order.filter((entryId) => entryId !== id);
  return createHistory({
    sessionsById,
    order,
    activeFileId:
      history.activeFileId === id
        ? order.length > 0
          ? order[order.length - 1]
          : null
        : history.activeFileId,
    analyzingFileId: history.analyzingFileId === id ? null : history.analyzingFileId,
  });
}

function applyRetention(history) {
  let nextHistory = history;
  while (nextHistory.order.length > FILE_ANALYSIS_HISTORY_LIMIT) {
    const removableId = nextHistory.order.find((id) => {
      if (id === nextHistory.activeFileId || id === nextHistory.analyzingFileId) return false;
      const entry = nextHistory.sessionsById[id];
      return entry && ANALYSIS_COMPLETE_STATES.has(entry.state);
    });
    if (!removableId) break;
    nextHistory = removeEntryById(nextHistory, removableId);
  }
  return nextHistory;
}

export function createInitialFileHistory() {
  return {
    sessionsById: {},
    order: [],
    activeFileId: null,
    analyzingFileId: null,
  };
}

export function getActiveFileSession(history) {
  return history.activeFileId ? (history.sessionsById[history.activeFileId] ?? null) : null;
}

export function getAnalyzingFileSession(history) {
  return history.analyzingFileId ? (history.sessionsById[history.analyzingFileId] ?? null) : null;
}

export function addFileEntry(history, options) {
  const id = options.id ?? generateFileSessionId();
  const now = options.createdAt ?? Date.now();
  const entry = {
    id,
    path: options.path,
    fileName: options.fileName ?? basename(options.path),
    state: "ready",
    metadata: options.metadata ?? null,
    summary: null,
    progress: 0,
    error: null,
    intake: options.intake ?? null,
    historyTruncated: false,
    historyCoveredMs: null,
    createdAt: now,
    analyzedAt: null,
    decodedFrames: 0,
    runId: 0,
  };

  return applyRetention(
    createHistory({
      sessionsById: {
        ...history.sessionsById,
        [id]: entry,
      },
      order: [...history.order, id],
      activeFileId: id,
      analyzingFileId: history.analyzingFileId,
    })
  );
}

export function selectFileEntry(history, id) {
  if (!history.sessionsById[id]) return history;
  return createHistory({
    ...history,
    activeFileId: id,
  });
}

export function updateFileEntry(history, id, updater) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  const updatedEntry = updater(entry);
  if (!updatedEntry || updatedEntry === entry) return history;
  return replaceEntry(history, id, updatedEntry);
}

export function startFileAnalysisEntry(history, id) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  return createHistory({
    ...replaceEntry(history, id, {
      ...entry,
      state: "analyzing",
      progress: 0,
      error: null,
      summary: null,
      historyTruncated: false,
      historyCoveredMs: null,
      analyzedAt: null,
      decodedFrames: 0,
      runId: (entry.runId ?? 0) + 1,
    }),
    activeFileId: id,
    analyzingFileId: id,
  });
}

export function markFileAnalysisComplete(history, id, payload = {}) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  return createHistory({
    ...replaceEntry(history, id, {
      ...entry,
      state: "complete",
      progress: 1,
      summary: payload.summary ?? null,
      decodedFrames: payload.decodedFrames ?? 0,
      historyTruncated: payload.historyTruncated ?? false,
      historyCoveredMs: payload.historyCoveredMs ?? null,
      analyzedAt: payload.analyzedAt ?? Date.now(),
      error: null,
    }),
    analyzingFileId: history.analyzingFileId === id ? null : history.analyzingFileId,
  });
}

export function markFileAnalysisError(history, id, payload = {}) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  return createHistory({
    ...replaceEntry(history, id, {
      ...entry,
      state: "error",
      error: payload.error ?? null,
      analyzedAt: payload.analyzedAt ?? Date.now(),
    }),
    analyzingFileId: history.analyzingFileId === id ? null : history.analyzingFileId,
  });
}

export function removeFileEntry(history, id) {
  if (!history.sessionsById[id]) return history;
  return removeEntryById(history, id);
}

export function clearFileHistory() {
  return createInitialFileHistory();
}
