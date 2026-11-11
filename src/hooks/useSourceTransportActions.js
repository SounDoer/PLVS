import { useCallback, useRef } from "react";
import { UI_PREFERENCES } from "../uiPreferences.js";
import { pickMediaFile } from "../ipc/fileDialog.js";

/**
 * @param {{
 *   sourceMode: string,
 *   running: boolean,
 *   liveLifecycle?: string,
 *   hasLiveHistory?: boolean | (() => boolean),
 *   selectedOffset: number,
 *   setSelectedOffset: (...args: any[]) => any,
 *   selectSnapshot?: (...args: any[]) => any,
 *   clearSnapshot?: (...args: any[]) => any,
 *   setHistoryOffsetSec: (...args: any[]) => any,
 *   setHistoryWindowSec: (...args: any[]) => any,
 *   startLive: (...args: any[]) => any,
 *   stopLive: (...args: any[]) => any,
 *   switchSource: (...args: any[]) => any,
 *   clearActiveSource: (...args: any[]) => any,
 *   beginRuntimeFileAnalysis: (...args: any[]) => any,
 *   reanalyzeFile: (...args: any[]) => any,
 *   selectFile: (...args: any[]) => any,
 *   removeFile: (...args: any[]) => any,
 *   clearFiles: (...args: any[]) => any,
 *   stopFileAnalysis: (...args: any[]) => any,
 *   activeFileSession: import("../lib/fileAnalysisSessionRegistry.js").FileSessionView | null,
 *   getFileAnalysisSettings: (...args: any[]) => any,
 *   onClearSucceeded: (...args: any[]) => any,
 *   importFile?: (...args: any[]) => any,
 *   fileTaskBusy?: boolean,
 *   fileImportBusy?: boolean,
 *   cancelFileImport?: () => void,
 * }} options
 */
export function useSourceTransportActions({
  sourceMode,
  running,
  liveLifecycle = running ? "running" : "stopped",
  hasLiveHistory = false,
  selectedOffset,
  setSelectedOffset,
  selectSnapshot = setSelectedOffset,
  clearSnapshot = () => setSelectedOffset(-1),
  setHistoryOffsetSec,
  setHistoryWindowSec,
  startLive,
  stopLive,
  switchSource,
  clearActiveSource,
  beginRuntimeFileAnalysis,
  reanalyzeFile,
  selectFile,
  removeFile,
  clearFiles,
  stopFileAnalysis,
  activeFileSession,
  getFileAnalysisSettings,
  onClearSucceeded,
  importFile,
  fileTaskBusy = false,
  fileImportBusy = false,
  cancelFileImport,
}) {
  const pickingRef = useRef(false);
  const resetHistoryViewport = useCallback(() => {
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
  }, [setHistoryOffsetSec, setHistoryWindowSec]);

  const clearAll = useCallback(async () => {
    const cleared = await clearActiveSource();
    if (cleared) {
      resetHistoryViewport();
      onClearSucceeded?.();
    }
  }, [clearActiveSource, onClearSucceeded, resetHistoryViewport]);

  const beginFileAnalysis = useCallback(
    (path) => {
      if (importFile) return importFile(path);
      return beginRuntimeFileAnalysis(path, getFileAnalysisSettings());
    },
    [beginRuntimeFileAnalysis, getFileAnalysisSettings, importFile]
  );

  const reanalyzeActiveFile = useCallback(
    (entry) => {
      reanalyzeFile(entry?.id, getFileAnalysisSettings());
    },
    [getFileAnalysisSettings, reanalyzeFile]
  );

  const openFile = useCallback(async () => {
    if (fileTaskBusy || pickingRef.current) return;
    pickingRef.current = true;
    try {
      const path = await pickMediaFile();
      if (path) await beginFileAnalysis(path);
    } finally {
      pickingRef.current = false;
    }
  }, [beginFileAnalysis, fileTaskBusy]);

  const onSelectFile = useCallback(
    (id) => {
      resetHistoryViewport();
      selectFile(id);
    },
    [resetHistoryViewport, selectFile]
  );

  const onStopFile = useCallback(
    (id) => {
      void stopFileAnalysis(id).catch(() => {});
    },
    [stopFileAnalysis]
  );

  const onReanalyzeFile = useCallback(
    (id) => {
      if (!fileTaskBusy) reanalyzeFile(id, getFileAnalysisSettings());
    },
    [fileTaskBusy, getFileAnalysisSettings, reanalyzeFile]
  );

  const onRemoveFile = useCallback(
    async (id) => {
      const clearedDisplay = await removeFile(id);
      if (clearedDisplay) resetHistoryViewport();
    },
    [removeFile, resetHistoryViewport]
  );

  const onClearAllFiles = useCallback(async () => {
    resetHistoryViewport();
    await clearFiles();
  }, [clearFiles, resetHistoryViewport]);

  const handleDropFile = useCallback((path) => beginFileAnalysis(path), [beginFileAnalysis]);

  const runLiveStartAction = useCallback(() => {
    if (selectedOffset >= 0) {
      clearSnapshot();
      return;
    }
    if (running) {
      stopLive();
      return;
    }
    startLive();
  }, [clearSnapshot, running, selectedOffset, startLive, stopLive]);

  const toggleLiveCapture = useCallback(() => {
    if (sourceMode !== "live") return;
    if (liveLifecycle === "running") {
      stopLive();
      return;
    }
    if (liveLifecycle === "stopped" || liveLifecycle === "error") startLive();
  }, [liveLifecycle, sourceMode, startLive, stopLive]);

  const toggleLiveSnapshot = useCallback(() => {
    if (sourceMode !== "live") return;
    if (selectedOffset >= 0) {
      clearSnapshot();
      return;
    }
    const historyAvailable =
      typeof hasLiveHistory === "function" ? hasLiveHistory() : hasLiveHistory;
    if (historyAvailable) selectSnapshot(0);
  }, [clearSnapshot, hasLiveHistory, selectSnapshot, selectedOffset, sourceMode]);

  const onSourceTransportAction = useCallback(
    async (/** @type {string} */ actionKind) => {
      if (actionKind === "returnToLive") {
        clearSnapshot();
        return;
      }
      if (actionKind === "startLive" || actionKind === "stopLive") {
        runLiveStartAction();
        return;
      }
      if (actionKind === "returnToFileResult") {
        clearSnapshot();
        return;
      }
      if (actionKind === "chooseFile") {
        await openFile();
        return;
      }
      if (actionKind === "analyzeFile") {
        if (activeFileSession?.path) {
          reanalyzeActiveFile(activeFileSession);
        } else {
          await openFile();
        }
        return;
      }
      if (actionKind === "reanalyzeFile" || actionKind === "retryFile") {
        if (!fileTaskBusy) reanalyzeActiveFile(activeFileSession);
        return;
      }
      if (actionKind === "stopFileAnalysis") {
        if (fileImportBusy) cancelFileImport?.();
        else await stopFileAnalysis().catch(() => {});
      }
    },
    [
      activeFileSession,
      openFile,
      reanalyzeActiveFile,
      runLiveStartAction,
      clearSnapshot,
      stopFileAnalysis,
      fileTaskBusy,
      fileImportBusy,
      cancelFileImport,
    ]
  );

  const onSourceModeChange = useCallback(
    (nextMode) => {
      if (nextMode === sourceMode) return;
      if (nextMode === "live") cancelFileImport?.();
      resetHistoryViewport();
      switchSource(nextMode);
    },
    [cancelFileImport, resetHistoryViewport, sourceMode, switchSource]
  );

  return {
    clearAll,
    openFile,
    onSelectFile,
    onStopFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    handleDropFile,
    onStartClick: runLiveStartAction,
    toggleLiveCapture,
    toggleLiveSnapshot,
    onSourceTransportAction,
    onSourceModeChange,
  };
}
