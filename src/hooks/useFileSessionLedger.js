import { useCallback, useMemo, useRef, useState } from "react";
import { FrameIntake } from "../lib/FrameIntake.js";
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
 * docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 */
export function useFileSessionLedger() {
  const [fileHistory, setFileHistory] = useState(() => createInitialFileHistory());
  const [fileRunRequest, setFileRunRequest] = useState(null);
  const fileEntrySeqRef = useRef(0);

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

  const updateSession = useCallback((sessionId, updater) => {
    setFileHistory((history) => updateFileEntry(history, sessionId, updater));
  }, []);

  const setAnalyzingFileId = useCallback((nextOrUpdater) => {
    setFileHistory((history) => {
      const nextId =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(history.analyzingFileId)
          : nextOrUpdater;
      const analyzingFileId = nextId && history.sessionsById[nextId] ? nextId : null;
      if (analyzingFileId === history.analyzingFileId) return history;
      return { ...history, analyzingFileId };
    });
  }, []);

  /** Mint a new session for `path` and mark it analyzing. Returns the session id. */
  const beginRun = useCallback((path, analysisSettings) => {
    const runId = fileEntrySeqRef.current + 1;
    fileEntrySeqRef.current = runId;
    const sessionId = `file-analysis-${Date.now()}-${runId}`;
    const intake = new FrameIntake();
    setFileHistory((history) =>
      startFileAnalysisEntry(
        addFileEntry(history, {
          id: sessionId,
          path,
          intake,
          analysisSettings,
        }),
        sessionId,
        { analysisSettings }
      )
    );
    setFileRunRequest({ sessionId, filePath: path, runId });
    return sessionId;
  }, []);

  /** Re-analyze an existing entry with fresh settings. */
  const rerun = useCallback((entryId, path, analysisSettings) => {
    const runId = fileEntrySeqRef.current + 1;
    fileEntrySeqRef.current = runId;
    setFileHistory((history) => startFileAnalysisEntry(history, entryId, { analysisSettings }));
    setFileRunRequest({ sessionId: entryId, filePath: path, runId });
  }, []);

  /** Record that `sessionId`'s run stopped: entry back to ready, no analyzing id, no run request. */
  const markStopped = useCallback((sessionId) => {
    setFileRunRequest(null);
    setFileHistory((history) => {
      if (history.analyzingFileId !== sessionId) return history;
      const updatedHistory = updateFileEntry(history, sessionId, (entry) => ({
        ...entry,
        state: "ready",
        progress: 0,
        error: null,
      }));
      return { ...updatedHistory, analyzingFileId: null };
    });
  }, []);

  const select = useCallback((id) => {
    setFileHistory((history) => selectFileEntry(history, id));
  }, []);

  const remove = useCallback((id) => {
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
