/**
 * One file in the analysis history, from the moment it is added.
 * @typedef {{
 *   id: string,
 *   path: string,
 *   fileName: string,
 *   state: "ready" | "analyzing" | "complete" | "error",
 *   metadata: any,
 *   summary: any,
 *   progress: number,
 *   error: any,
 *   intake: any,
 *   createdAt: number,
 *   lastViewedAt?: number,
 *   historyReleased?: boolean,
 *   analyzedAt: number | null,
 *   decodedFrames: number,
 *   runId: number,
 *   analysisSettings: any,
 *   successfulResult?: any,
 *   attempt?: any,
 * }} FileSession
 */

/**
 * A file session as the UI is handed one: the app passes `{ state: "empty" }` when no file is
 * selected and some callers default to an empty record, so every field may be absent.
 * @typedef {Partial<Omit<FileSession, "state">> & { state?: FileSession["state"] | "empty" }} FileSessionView
 */

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
  const now = options.now ?? options.createdAt ?? Date.now();
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
    createdAt: now,
    lastViewedAt: now,
    historyReleased: false,
    analyzedAt: null,
    decodedFrames: 0,
    runId: 0,
    analysisSettings: options.analysisSettings ?? null,
  };

  return createHistory({
    sessionsById: {
      ...history.sessionsById,
      [id]: entry,
    },
    order: [...history.order, id],
    activeFileId: id,
    analyzingFileId: history.analyzingFileId,
  });
}

/**
 * @param {string} id
 */
export function selectFileEntry(history, id, now = Date.now()) {
  if (!history.sessionsById[id]) return history;
  return createHistory({
    ...history,
    sessionsById: {
      ...history.sessionsById,
      [id]: { ...history.sessionsById[id], lastViewedAt: now },
    },
    activeFileId: id,
  });
}

/**
 * @param {string} id
 */
export function updateFileEntry(history, id, updater) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  let updatedEntry = updater(entry);
  if (!updatedEntry || updatedEntry === entry) return history;
  if (updatedEntry.state === "complete" && updatedEntry.summary) {
    const attempt = updatedEntry.attempt;
    const restored = attempt?.kind === "restore" && entry.successfulResult;
    updatedEntry = {
      ...updatedEntry,
      ...(restored ? entry.successfulResult : {}),
      metadata: restored
        ? entry.successfulResult.metadata
        : (attempt?.metadata ?? updatedEntry.metadata),
      analysisSettings: restored
        ? entry.successfulResult.analysisSettings
        : (attempt?.analysisSettings ?? updatedEntry.analysisSettings),
      intake: attempt?.intake ?? updatedEntry.intake,
      audio: restored ? entry.successfulResult.audio : updatedEntry.audio,
      historyReleased: attempt?.intake ? false : (updatedEntry.historyReleased ?? false),
      attempt: null,
    };
    updatedEntry.successfulResult = captureSuccessfulResult(updatedEntry);
  } else if (updatedEntry.state === "error") {
    updatedEntry = { ...updatedEntry, attempt: null };
  }
  return replaceEntry(history, id, updatedEntry);
}

function captureSuccessfulResult(entry) {
  return {
    path: entry.path,
    fileName: entry.fileName,
    metadata: entry.metadata,
    summary: entry.summary,
    analysisSettings: entry.analysisSettings,
    analyzedAt: entry.analyzedAt,
    decodedFrames: entry.decodedFrames,
    intake: entry.intake,
    audio: entry.audio,
  };
}

/** A stable completed-result view, independent of a replacement attempt's lifecycle. */
export function getSuccessfulFileSession(entry) {
  if (!entry) return null;
  if (entry.successfulResult) return { ...entry, ...entry.successfulResult, state: "complete" };
  return entry.state === "complete" && entry.summary ? entry : null;
}

/**
 * @param {string} id
 */
export function startFileAnalysisEntry(history, id, options = {}) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  const successful = getSuccessfulFileSession(entry);
  const successfulResult = successful ? captureSuccessfulResult(successful) : null;
  const analysisSettings = options.analysisSettings ?? entry.analysisSettings ?? null;
  const attempt = {
    kind: options.kind ?? "analyze",
    runId: (entry.runId ?? 0) + 1,
    metadata: null,
    analysisSettings,
    intake: options.intake ?? entry.intake,
  };
  return createHistory({
    ...replaceEntry(history, id, {
      ...entry,
      state: "analyzing",
      progress: 0,
      error: null,
      summary: successfulResult?.summary ?? null,
      analyzedAt: successfulResult?.analyzedAt ?? null,
      decodedFrames: successfulResult?.decodedFrames ?? 0,
      runId: attempt.runId,
      analysisSettings: successfulResult?.analysisSettings ?? analysisSettings,
      successfulResult,
      attempt,
    }),
    activeFileId: options.preserveSelection ? history.activeFileId : id,
    analyzingFileId: id,
  });
}

/**
 * @param {string} id
 */
export function markFileAnalysisComplete(history, id, payload = {}) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  return createHistory({
    ...updateFileEntry(history, id, () => ({
      ...entry,
      state: "complete",
      progress: 1,
      summary: payload.summary ?? null,
      decodedFrames: payload.decodedFrames ?? 0,
      analyzedAt: payload.now ?? payload.analyzedAt ?? Date.now(),
      error: null,
    })),
    analyzingFileId: history.analyzingFileId === id ? null : history.analyzingFileId,
  });
}

/**
 * @param {string} id
 */
export function markFileAnalysisError(history, id, payload = {}) {
  const entry = history.sessionsById[id];
  if (!entry) return history;
  return createHistory({
    ...updateFileEntry(history, id, () => ({
      ...entry,
      state: "error",
      error: payload.error ?? null,
      analyzedAt: payload.now ?? payload.analyzedAt ?? Date.now(),
    })),
    analyzingFileId: history.analyzingFileId === id ? null : history.analyzingFileId,
  });
}

/**
 * @param {string} id
 */
export function removeFileEntry(history, id) {
  if (!history.sessionsById[id]) return history;
  return removeEntryById(history, id);
}

export function clearFileHistory() {
  return createInitialFileHistory();
}
