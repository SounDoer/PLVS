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
import { FileAudioTrackDialog } from "../components/FileAudioTrackDialog.jsx";
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
    analyzingFileId,
    startLive,
    stopLive,
    switchSource,
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
        enabled: dialogueGating,
        engine: dialogueGating ? settings.dialogueVadEngine : null,
        engineConfiguration: dialogueGating ? "default" : null,
        multichannelFusion: dialogueGating ? "center-priority-fallback-v1" : null,
      },
    }),
    [dialogueGating, settings.dialogueVadEngine, settings.channelLabelOverrides, fileConditionsRef]
  );
  const { exportFileAnalysisReport, copyFileAnalysisReportMarkdown } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    raiseNotice,
    loudnessProfile,
  });
  const fileImport = useFileImport({
    files: fileSessions,
    busy: Boolean(analyzingFileId),
    getSettings: currentFileAnalysisSettings,
    begin: beginRuntimeFileAnalysis,
    select: selectFile,
    raiseNotice,
  });
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
    importFile: fileImport.importFile,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
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
  useDialogueEngineRestart(dialogueVadEngine, sourceMode === "live" && dialogueGating, onClearRef);

  return (
    <SourceActionsContext.Provider
      value={{
        ...actions,
        fileImport,
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
        selection={fileImport.selection}
        onConfirm={fileImport.confirm}
        onCancel={fileImport.cancel}
      />
      {children}
    </SourceActionsContext.Provider>
  );
}

export function useSourceActions() {
  const actions = useContext(SourceActionsContext);
  if (!actions) throw new Error("useSourceActions must be used inside SourceActionsProvider");
  return actions;
}
