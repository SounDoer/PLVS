import { createContext, useCallback, useContext, useMemo, useState } from "react";
import packageInfo from "../../package.json";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useFileAnalysisReportExport } from "../hooks/useFileAnalysisReportExport.js";
import { useSourceTransportActions } from "../hooks/useSourceTransportActions.js";
import { useDialogueEngineRestart } from "../hooks/useDialogueEngineRestart.js";
import { deriveDialogueRuntime } from "./appRuntimeDerivations.js";
import { useMeterDisplayState, useMeterRuntime } from "./MeterRuntimeContext.jsx";

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

/**
 * @typedef {ReturnType<typeof useSourceTransportActions> & {
 *   fileSession: any,
 *   dialogueGating: boolean,
 *   currentFileAnalysisSettings: () => { dialogue: { enabled: boolean, engine: any } },
 *   exportFileAnalysisReport: (...args: any[]) => any,
 *   copyFileAnalysisReportMarkdown: (...args: any[]) => any,
 *   vectorscopeResetEpoch: number,
 *   stereoMapResetEpoch: number,
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
    activeFileSession,
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
  const { selectedOffset, setSelectedOffset, raiseNotice } = useMeterDisplayState();
  const settings = useAppSettings();
  const { onClearRef, dialogueVadEngine } = settings;
  const loudnessProfile = useLoudnessProfile();

  const [vectorscopeResetEpoch, setVectorscopeResetEpoch] = useState(0);
  const [stereoMapResetEpoch, setStereoMapResetEpoch] = useState(0);
  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const { dialogueGating } = useMemo(() => deriveDialogueRuntime(workspaceState), [workspaceState]);
  const currentFileAnalysisSettings = useCallback(
    () => ({
      dialogue: {
        enabled: dialogueGating,
        engine: dialogueGating ? settings.dialogueVadEngine : null,
      },
    }),
    [dialogueGating, settings.dialogueVadEngine]
  );
  const { exportFileAnalysisReport, copyFileAnalysisReportMarkdown } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    raiseNotice,
    loudnessProfile,
  });
  const actions = useSourceTransportActions({
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
    getFileAnalysisSettings: currentFileAnalysisSettings,
    onClearSucceeded: () => {
      setVectorscopeResetEpoch((epoch) => epoch + 1);
      setStereoMapResetEpoch((epoch) => epoch + 1);
    },
  });
  onClearRef.current = actions.clearAll;
  useDialogueEngineRestart(dialogueVadEngine, dialogueGating, onClearRef);

  return (
    <SourceActionsContext.Provider
      value={{
        ...actions,
        fileSession,
        dialogueGating,
        currentFileAnalysisSettings,
        exportFileAnalysisReport,
        copyFileAnalysisReportMarkdown,
        vectorscopeResetEpoch,
        stereoMapResetEpoch,
      }}
    >
      {children}
    </SourceActionsContext.Provider>
  );
}

export function useSourceActions() {
  const actions = useContext(SourceActionsContext);
  if (!actions) throw new Error("useSourceActions must be used inside SourceActionsProvider");
  return actions;
}
