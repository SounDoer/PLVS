import { useCallback } from "react";
import { UI_PREFERENCES } from "../uiPreferences.js";
import { pickMediaFile } from "../ipc/fileDialog.js";

export function useSourceTransportActions({
  sourceMode,
  running,
  selectedOffset,
  setSelectedOffset,
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
}) {
  const resetHistoryViewport = useCallback(() => {
    setHistoryOffsetSec(0);
    setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
  }, [setHistoryOffsetSec, setHistoryWindowSec]);

  const clearAll = useCallback(async () => {
    const cleared = await clearActiveSource();
    if (cleared) resetHistoryViewport();
  }, [clearActiveSource, resetHistoryViewport]);

  const beginFileAnalysis = useCallback(
    (path) => {
      beginRuntimeFileAnalysis(path, getFileAnalysisSettings());
    },
    [beginRuntimeFileAnalysis, getFileAnalysisSettings]
  );

  const reanalyzeActiveFile = useCallback(
    (entry) => {
      reanalyzeFile(entry?.id, getFileAnalysisSettings());
    },
    [getFileAnalysisSettings, reanalyzeFile]
  );

  const openFile = useCallback(async () => {
    const path = await pickMediaFile();
    if (path) beginFileAnalysis(path);
  }, [beginFileAnalysis]);

  const onSelectFile = useCallback(
    (id) => {
      resetHistoryViewport();
      selectFile(id);
    },
    [resetHistoryViewport, selectFile]
  );

  const onStopFile = useCallback(
    (id) => {
      void stopFileAnalysis(id);
    },
    [stopFileAnalysis]
  );

  const onReanalyzeFile = useCallback(
    (id) => {
      reanalyzeFile(id, getFileAnalysisSettings());
    },
    [getFileAnalysisSettings, reanalyzeFile]
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
      setSelectedOffset(-1);
      return;
    }
    if (running) {
      stopLive();
      return;
    }
    startLive();
  }, [running, selectedOffset, setSelectedOffset, startLive, stopLive]);

  const onSourceTransportAction = useCallback(
    async (actionKind) => {
      if (actionKind === "returnToLive") {
        setSelectedOffset(-1);
        return;
      }
      if (actionKind === "startLive" || actionKind === "stopLive") {
        runLiveStartAction();
        return;
      }
      if (actionKind === "returnToFileResult") {
        setSelectedOffset(-1);
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
      if (actionKind === "reanalyzeFile") {
        reanalyzeActiveFile(activeFileSession);
        return;
      }
      if (actionKind === "stopFileAnalysis") {
        void stopFileAnalysis();
      }
    },
    [
      activeFileSession,
      openFile,
      reanalyzeActiveFile,
      runLiveStartAction,
      setSelectedOffset,
      stopFileAnalysis,
    ]
  );

  const onSourceModeChange = useCallback(
    (nextMode) => {
      if (nextMode === sourceMode) return;
      resetHistoryViewport();
      switchSource(nextMode);
    },
    [resetHistoryViewport, sourceMode, switchSource]
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
    onSourceTransportAction,
    onSourceModeChange,
  };
}
