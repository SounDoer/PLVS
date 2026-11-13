import { createContext, useCallback, useContext, useMemo, useState } from "react";
import packageInfo from "../../package.json";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useFileAnalysisReportExport } from "../hooks/useFileAnalysisReportExport.js";
import { useSourceTransportActions } from "../hooks/useSourceTransportActions.js";
import { useDialogueEngineRestart } from "../hooks/useDialogueEngineRestart.js";
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
 *   onExportFileStatistics: () => void,
 * }} SourceActions
 */
const SourceActionsContext = createContext(/** @type {SourceActions | null} */ (null));

/**
 * What the user does to the active source: start and stop, clear, and the file actions.
 *
 * Assigns the settings owner's clear ref during render. The clear shortcut is registered out there
 * and the action lives in here; see `SettingsProvider`.
 */
export function SourceActionsProvider({ children }) {
  const { state: workspaceState } = useWorkspaceStore();
  const { setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const {
    sourceMode,
    running,
    liveLifecycle,
    activeFileSession,
    fileSessions,
    fileTaskBusy,
    startLive,
    stopLive,
    switchSource,
    deferLiveClear,
    clearActiveSource,
    beginFileAnalysis: beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
    stopFileAnalysis,
  } = useMeterRuntime();
  const { liveIntakeRef, fileConditionsRef } = useMeterRuntimeAssembly();
  const { selectedOffset, setSelectedOffset, selectSnapshot, clearSnapshot, raiseNotice } =
    useMeterDisplayState();
  const settings = useAppSettings();
  const { onClearRef, shortcutActionRef, onHistoryRetentionChangeRef, dialogueVadEngine } =
    settings;
  const fileDialogueDetection = settings.fileDialogueDetection === true;
  const loudnessProfile = useLoudnessProfile();

  const [vectorscopeResetEpoch, setVectorscopeResetEpoch] = useState(0);
  const [stereoMapResetEpoch, setStereoMapResetEpoch] = useState(0);
  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const { dialogueGating } = useMemo(() => deriveDialogueRuntime(workspaceState), [workspaceState]);
  const currentFileAnalysisSettings = useCallback(
    () => ({
      ...(fileConditionsRef.current ? { requests: fileConditionsRef.current } : {}),
      channelRolesByCount: settings.channelLabelOverrides,
      dialogue: {
        enabled: fileDialogueDetection,
        engine: fileDialogueDetection ? settings.dialogueVadEngine : null,
        engineConfiguration: fileDialogueDetection ? "default" : null,
        multichannelFusion: fileDialogueDetection ? "center-priority-fallback-v1" : null,
      },
    }),
    [
      fileDialogueDetection,
      settings.dialogueVadEngine,
      settings.channelLabelOverrides,
      fileConditionsRef,
    ]
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
  });
  const statistics = useFileStatisticsExport({
    fileSessions,
    loudnessProfile,
    raiseNotice,
    appVersion: APP_VERSION,
  });
  const { active: queueActive, enqueue } = fileQueue;
  const { importFile } = fileImport;
  const importMedia = useCallback(
    (input) => {
      const paths = Array.isArray(input) ? input : [input];
      if (!paths.length || sourceMode !== "file") return;
      if (isTauri() && (paths.length > 1 || queueActive || fileTaskBusy)) enqueue(paths);
      else return importFile(paths[0]);
    },
    [sourceMode, queueActive, fileTaskBusy, enqueue, importFile]
  );
  const actions = useSourceTransportActions({
    sourceMode,
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
      fileImport.cancel();
      if (fileQueue.probing) fileQueue.stopCurrent()?.catch(() => {});
    },
    reanalyzeFile,
    selectFile: (id) => {
      fileQueue.onFileSelected(id);
      if (id !== activeFileSession?.id) selectFile(id);
    },
    removeFile,
    clearFiles: async () => {
      fileQueue.clear();
      await clearFiles();
    },
    stopFileAnalysis,
    activeFileSession,
    getFileAnalysisSettings: currentFileAnalysisSettings,
    onClearSucceeded: () => {
      setVectorscopeResetEpoch((epoch) => epoch + 1);
      setStereoMapResetEpoch((epoch) => epoch + 1);
    },
  });
  onClearRef.current = actions.clearAll;
  shortcutActionRef.current = (actionId) => {
    if (actionId === "toggleLiveCapture") return actions.toggleLiveCapture();
    if (actionId === "toggleLiveSnapshot") return actions.toggleLiveSnapshot();
    if (actionId === "clear") return actions.clearAll();
  };
  onHistoryRetentionChangeRef.current = sourceMode === "live" ? actions.clearAll : async () => true;
  useDialogueEngineRestart(
    dialogueVadEngine,
    dialogueGating,
    sourceMode === "live",
    onClearRef,
    deferLiveClear
  );

  return (
    <SourceActionsContext.Provider
      value={{
        ...actions,
        fileImport,
        fileQueue,
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
        selection={fileImport.selection ?? fileQueue.selection}
        onConfirm={fileImport.selection ? fileImport.confirm : fileQueue.confirm}
        onCancel={fileImport.selection ? fileImport.cancel : fileQueue.dismiss}
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
      {children}
    </SourceActionsContext.Provider>
  );
}

export function useSourceActions() {
  const actions = useContext(SourceActionsContext);
  if (!actions) throw new Error("useSourceActions must be used inside SourceActionsProvider");
  return actions;
}
