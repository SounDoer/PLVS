import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FrameIntake } from "../lib/FrameIntake.js";
import { enforceFileHistoryBudget, FILE_HISTORY_BUDGET_BYTES } from "../lib/fileHistoryBudget.js";
import {
  addFileEntry,
  clearFileHistory,
  createInitialFileHistory,
  getActiveFileSession,
  getAnalyzingFileSession,
  removeFileEntry,
  selectFileEntry,
  startFileAnalysisEntry,
  updateFileEntry,
} from "../lib/fileAnalysisSessionRegistry.js";

/**
 * Owner of the file-analysis session ledger: the session history, the pending
 * run request, and the run-id counter, plus the primitive verbs that mutate
 * them. Cross-domain orchestration (notice lifecycle, engine stop, scrub-offset
 * resets, source switching) stays with the caller and composes these verbs —
 * same seam style as useCaptureTransport. See
 * docs/history/specs/2026-07-08-c2-app-state-ownership-design.md.
 */
export function useFileSessionLedger({
  budget = FILE_HISTORY_BUDGET_BYTES,
  protectedFileId = null,
} = {}) {
  const [fileHistory, setFileHistory] = useState(() => createInitialFileHistory());
  const [fileRunRequest, setFileRunRequest] = useState(null);
  const fileEntrySeqRef = useRef(0);
  const lastBudgetCheckRef = useRef(0);
  const enforce = useCallback(
    (history) => enforceFileHistoryBudget(history, budget, protectedFileId),
    [budget, protectedFileId]
  );

  // A history the ledger no longer references (released by the budget, removed, cleared, replaced
  // by a successful rerun, or a discarded attempt) is emptied after commit. Memoized callbacks
  // elsewhere can still close over an old entry object; emptying the store keeps such a stale
  // reference from pinning the history's buffers. Restoration always starts a new intake.
  const ledgerIntakesRef = useRef(new Set());
  useEffect(() => {
    const current = new Set();
    for (const entry of Object.values(fileHistory.sessionsById)) {
      for (const intake of [entry.intake, entry.successfulResult?.intake, entry.attempt?.intake])
        if (intake) current.add(intake);
    }
    for (const intake of ledgerIntakesRef.current) if (!current.has(intake)) intake.reset?.();
    ledgerIntakesRef.current = current;
  }, [fileHistory]);

  const fileSessions = useMemo(
    () => fileHistory.order.map((id) => fileHistory.sessionsById[id]).filter(Boolean),
    [fileHistory]
  );
  const activeFileSession = useMemo(() => getActiveFileSession(fileHistory), [fileHistory]);
  const analyzingFileSession = useMemo(() => getAnalyzingFileSession(fileHistory), [fileHistory]);

  // A run request is only actionable while its session is still the analyzing one.
  const validRunRequest =
    fileRunRequest &&
    fileRunRequest.sessionId === fileHistory.analyzingFileId &&
    fileHistory.sessionsById[fileRunRequest.sessionId]
      ? fileRunRequest
      : null;

  const updateSession = useCallback(
    (/** @type {string} */ sessionId, updater) => {
      // Lifecycle/progress updates bound growing protected storage without traversing it per frame.
      const now = performance.now();
      const check = now - lastBudgetCheckRef.current >= 1000;
      if (check) lastBudgetCheckRef.current = now;
      setFileHistory((history) => {
        const next = updateFileEntry(history, sessionId, updater);
        return check ? enforce(next) : next;
      });
    },
    [enforce]
  );

  const setAnalyzingFileId = useCallback(
    (nextOrUpdater) => {
      setFileHistory((history) => {
        const nextId =
          typeof nextOrUpdater === "function"
            ? nextOrUpdater(history.analyzingFileId)
            : nextOrUpdater;
        const analyzingFileId = nextId && history.sessionsById[nextId] ? nextId : null;
        if (analyzingFileId === history.analyzingFileId) return history;
        return enforce({ ...history, analyzingFileId });
      });
    },
    [enforce]
  );

  /** Mint a new session for `path` and mark it analyzing. Returns the session id. */
  const beginRun = useCallback(
    (path, analysisSettings, probe = null, onCreated = null, activate = true) => {
      analysisSettings = structuredClone(analysisSettings ?? {});
      const runId = fileEntrySeqRef.current + 1;
      fileEntrySeqRef.current = runId;
      const sessionId = `file-analysis-${Date.now()}-${runId}`;
      onCreated?.(sessionId);
      const intake = new FrameIntake();
      setFileHistory((history) =>
        enforce(
          startFileAnalysisEntry(
            addFileEntry(history, {
              id: sessionId,
              path,
              intake,
              analysisSettings,
              metadata: probe,
              activate,
            }),
            sessionId,
            { analysisSettings, preserveSelection: !activate }
          )
        )
      );
      setFileRunRequest({ sessionId, filePath: path, runId, analysisSettings, probe });
      return sessionId;
    },
    [enforce]
  );

  /** Re-analyze an existing entry with fresh settings. */
  const rerun = useCallback(
    (
      /** @type {string} */ entryId,
      path,
      analysisSettings,
      probe = null,
      kind = "analyze",
      activate = false
    ) => {
      analysisSettings = structuredClone(analysisSettings ?? {});
      const runId = fileEntrySeqRef.current + 1;
      fileEntrySeqRef.current = runId;
      const intake = new FrameIntake();
      setFileHistory((history) =>
        enforce(
          startFileAnalysisEntry(history, entryId, {
            analysisSettings,
            intake,
            kind,
            preserveSelection: !activate,
          })
        )
      );
      setFileRunRequest({ sessionId: entryId, filePath: path, runId, analysisSettings, probe });
    },
    [enforce]
  );

  /** Record that `sessionId`'s run stopped: entry canceled or back to its result, no analyzing id, no run request. */
  const markStopped = useCallback(
    (/** @type {string} */ sessionId) => {
      setFileRunRequest(null);
      setFileHistory((history) => {
        if (history.analyzingFileId !== sessionId) return history;
        const updatedHistory = updateFileEntry(history, sessionId, (entry) => ({
          ...entry,
          state: entry.successfulResult ? "complete" : "canceled",
          error: null,
          attempt: null,
        }));
        return enforce({ ...updatedHistory, analyzingFileId: null });
      });
    },
    [enforce]
  );

  const select = useCallback(
    (/** @type {string} */ id) => {
      setFileHistory((history) => enforce(selectFileEntry(history, id)));
    },
    [enforce]
  );

  const remove = useCallback((/** @type {string} */ id) => {
    setFileHistory((history) => removeFileEntry(history, id));
  }, []);

  const clearAll = useCallback(() => {
    setFileRunRequest(null);
    setFileHistory(clearFileHistory());
  }, []);

  const clearRunRequest = useCallback(() => setFileRunRequest(null), []);

  return {
    fileHistory,
    fileSessions,
    activeFileSession,
    analyzingFileSession,
    validRunRequest,
    updateSession,
    setAnalyzingFileId,
    beginRun,
    rerun,
    markStopped,
    select,
    remove,
    clearAll,
    clearRunRequest,
  };
}
