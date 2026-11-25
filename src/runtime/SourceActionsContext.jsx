import { UI_PREFERENCES } from "../uiPreferences.js";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import packageInfo from "../../package.json";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { ShortcutSettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useFileAnalysisReportExport } from "../hooks/useFileAnalysisReportExport.js";
import { useSourceTransportActions } from "../hooks/useSourceTransportActions.js";
import { useFileImport } from "../hooks/useFileImport.js";
import { useFileImportQueue } from "../hooks/useFileImportQueue.js";
import { isTauri } from "../ipc/env.js";
import { FileAudioTrackDialog } from "../components/FileAudioTrackDialog.jsx";
import { ItemPickerDialog } from "../components/ItemPickerDialog.jsx";
import { useFileStatisticsExport } from "../hooks/useFileStatisticsExport.js";
import { deriveDialogueRuntime } from "./appRuntimeDerivations.js";
import {
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

/**
 * @typedef {ReturnType<typeof useSourceTransportActions> & {
 *   canClear: boolean,
 *   dispatchShortcut: (actionId: string) => any,
 *   changeHistoryRetention: (value: string | number, options?: { target?: any, strict?: boolean, reset?: boolean }) => Promise<boolean>,
 *   resetLiveDisplayControls: (target: ReturnType<ReturnType<typeof useMeterRuntime>["liveClearTarget"]>) => void,
 *   fileSession: any,
 *   dialogueGating: boolean,
 *   currentFileAnalysisSettings: () => { dialogue: {
 *     enabled: boolean,
 *     engine: any,
 *     engineConfiguration: string | null,
 *     multichannelFusion: string | null,
 *   } },
 *   exportFileAnalysisReport: (...args: any[]) => any,
 *   copyFileAnalysisReportMarkdown: (...args: any[]) => any,
 *   vectorscopeResetEpoch: number,
 *   stereoMapResetEpoch: number,
 *   fileImport: ReturnType<typeof useFileImport>,
 *   fileQueue: ReturnType<typeof useFileImportQueue>,
 *   clearFileCollection: () => Promise<void>,
 *   onExportFileStatistics: () => void,
 * }} SourceActions
 */
const SourceActionsContext = createContext(/** @type {SourceActions | null} */ (null));

/**
 * What the user does to the active source: start and stop, clear, and the file actions.
 *
 * Shortcut inputs and History Length settings call the same actions as the source controls.
 */
export function SourceActionsProvider({ children }) {
  const { state: workspaceState } = useWorkspaceStore();
  const { setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const {
    sourceMode,
    getFileSourceToken,
    running,
    liveLifecycle,
    activeFileSession,
    fileSessions,
    fileTaskBusy,
    replacementTrackSelection,
    startLive,
    stopLive,
    switchSource,
    clearActiveSource,
    clearLiveForControl,
    liveClearTarget,
    beginFileAnalysis: beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
    stopFileAnalysis,
  } = useMeterRuntime();
  const { liveIntakeRef, fileRequestInputsRef } = useMeterRuntimeAssembly();
  const {
    selectedOffset,
    setSelectedOffset,
    selectSnapshot,
    clearSnapshot,
    raiseNotice,
    showClock,
  } = useMeterDisplayState();
  const canClear = sourceMode === "file" ? Boolean(activeFileSession) : running || showClock;
  const settings = useAppSettings();
  const { setHistoryRetentionSec } = settings;
  const fileDialogueDetection = settings.fileDialogueDetection === true;
  const loudnessProfile = useLoudnessProfile();

  const [vectorscopeResetEpoch, setVectorscopeResetEpoch] = useState(0);
  const [stereoMapResetEpoch, setStereoMapResetEpoch] = useState(0);
  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const { dialogueGating } = useMemo(() => deriveDialogueRuntime(workspaceState), [workspaceState]);
  const currentFileAnalysisSettings = useCallback(
    () => ({
      requestInputs: fileRequestInputsRef.current,
      dialogue: {
        enabled: fileDialogueDetection,
        engine: fileDialogueDetection ? settings.dialogueVadEngine : null,
        engineConfiguration: fileDialogueDetection ? "default" : null,
        multichannelFusion: fileDialogueDetection ? "center-priority-fallback-v1" : null,
      },
    }),
    [fileDialogueDetection, settings.dialogueVadEngine, fileRequestInputsRef]
  );
  const { exportFileAnalysisReport, copyFileAnalysisReportMarkdown } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    raiseNotice,
    loudnessProfile,
  });
  const fileImport = useFileImport({
    files: fileSessions,
    busy: fileTaskBusy,
    getSettings: currentFileAnalysisSettings,
    begin: beginRuntimeFileAnalysis,
    select: selectFile,
    raiseNotice,
    getFileSourceToken,
  });
  const fileQueue = useFileImportQueue({
    enabled: sourceMode === "file",
    busy: fileTaskBusy || fileImport.importBusy || Boolean(fileImport.selection),
    files: fileSessions,
    activeFileId: activeFileSession?.id,
    getSettings: currentFileAnalysisSettings,
    begin: beginRuntimeFileAnalysis,
    select: selectFile,
    stop: stopFileAnalysis,
    raiseNotice,
  });
  const statistics = useFileStatisticsExport({
    fileSessions,
    loudnessProfile,
    raiseNotice,
    appVersion: APP_VERSION,
  });
  const { active: queueActive, enqueue } = fileQueue;
  const { importFile } = fileImport;
  const clearFileCollection = () =>
    clearFiles(async () => {
      await fileImport.cancel();
      await fileQueue.clear();
    });
  const importMedia = useCallback(
    (input) => {
      const paths = Array.isArray(input) ? input : [input];
      if (!paths.length || !getFileSourceToken()) return;
      if (isTauri() && (paths.length > 1 || queueActive || fileTaskBusy)) enqueue(paths);
      else return importFile(paths[0]);
    },
    [getFileSourceToken, queueActive, fileTaskBusy, enqueue, importFile]
  );
  const actions = useSourceTransportActions({
    sourceMode,
    getFileSourceToken,
    running,
    liveLifecycle,
    hasLiveHistory: () => liveIntakeRef.current.getLoudnessHistory().length > 0,
    selectedOffset,
    setSelectedOffset,
    selectSnapshot,
    clearSnapshot,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    startLive,
    stopLive,
    switchSource,
    clearActiveSource,
    beginRuntimeFileAnalysis,
    importFile: importMedia,
    fileTaskBusy:
      fileTaskBusy || fileQueue.active || fileImport.importBusy || Boolean(fileImport.selection),
    fileImportBusy: fileImport.importBusy || fileQueue.probing,
    cancelFileImport: () => {
      void fileImport.cancel().catch(() => {});
      if (fileQueue.probing) fileQueue.stopCurrent()?.catch(() => {});
    },
    reanalyzeFile,
    selectFile: (id) => {
      fileQueue.onFileSelected(id);
      if (id !== activeFileSession?.id) selectFile(id);
    },
    removeFile,
    clearFiles: clearFileCollection,
    stopFileAnalysis,
    activeFileSession,
    getFileAnalysisSettings: currentFileAnalysisSettings,
    raiseNotice,
    onClearSucceeded: () => {
      setVectorscopeResetEpoch((epoch) => epoch + 1);
      setStereoMapResetEpoch((epoch) => epoch + 1);
    },
  });
  const dispatchShortcut = (actionId) => {
    if (actionId === "toggleLiveCapture") return actions.toggleLiveCapture();
    if (actionId === "toggleLiveSnapshot") return actions.toggleLiveSnapshot();
    if (actionId === "clear") return canClear ? actions.clearAll() : false;
  };
  const resetLiveDisplayControls = useCallback(
    (target) => {
      const current = liveClearTarget();
      if (current.selection !== target.selection || current.meter !== target.meter) return;
      setHistoryOffsetSec(0);
      setHistoryWindowSec(UI_PREFERENCES.modules.loudness.history.defaultWindowSec);
      setVectorscopeResetEpoch((epoch) => epoch + 1);
      setStereoMapResetEpoch((epoch) => epoch + 1);
    },
    [liveClearTarget, setHistoryOffsetSec, setHistoryWindowSec]
  );
  const changeHistoryRetention = async (
    value,
    { target = liveClearTarget(), strict = false, reset = true } = {}
  ) => {
    const changed = setHistoryRetentionSec(value);
    if (!changed || !reset || target.selection.mode !== "live") return changed;
    try {
      await clearLiveForControl(target);
      resetLiveDisplayControls(target);
    } catch (error) {
      if (strict) throw error;
      if (liveClearTarget().selection === target.selection) {
        raiseNotice("error", "Could not clear the Live measurement", error.message, {
          requiresAttention: true,
        });
      }
    }
    return true;
  };
  return (
    <SourceActionsContext.Provider
      value={{
        ...actions,
        dispatchShortcut,
        changeHistoryRetention,
        resetLiveDisplayControls,
        canClear,
        fileImport,
        fileQueue,
        clearFileCollection,
        onExportFileStatistics: statistics.onOpen,
        fileSession,
        dialogueGating,
        currentFileAnalysisSettings,
        exportFileAnalysisReport,
        copyFileAnalysisReportMarkdown,
        vectorscopeResetEpoch,
        stereoMapResetEpoch,
      }}
    >
      <FileAudioTrackDialog
        selection={replacementTrackSelection ?? fileImport.selection ?? fileQueue.selection}
        onConfirm={
          replacementTrackSelection?.onConfirm ??
          (fileImport.selection ? fileImport.confirm : fileQueue.confirm)
        }
        onCancel={
          replacementTrackSelection?.onCancel ??
          (fileImport.selection ? () => fileImport.cancel().catch(() => {}) : fileQueue.dismiss)
        }
      />
      {statistics.open ? (
        <ItemPickerDialog
          open
          type="fileStatistics"
          mode="pick"
          items={statistics.items}
          busy={statistics.busy}
          onExport={statistics.onExport}
          onClose={statistics.onClose}
        />
      ) : null}
      <ShortcutSettingsProvider dispatchShortcut={dispatchShortcut}>
        {children}
      </ShortcutSettingsProvider>
    </SourceActionsContext.Provider>
  );
}

export function useSourceActions() {
  const actions = useContext(SourceActionsContext);
  if (!actions) throw new Error("useSourceActions must be used inside SourceActionsProvider");
  return actions;
}
