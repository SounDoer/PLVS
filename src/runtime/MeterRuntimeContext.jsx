import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCaptureTransport } from "../hooks/useCaptureTransport.js";
import { useFileSessionLedger } from "../hooks/useFileSessionLedger.js";
import { useIntakeRouting } from "../hooks/useIntakeRouting.js";
import { useMeterDisplay } from "../hooks/useMeterDisplay.js";
import { startFileProbe } from "../ipc/commands.js";
import { errorMessage } from "../lib/errorDetails.js";
import { sameFileSourceVersion, withSelectedAudioTrack } from "../lib/fileAnalysisSource.js";
import { fileImportTracks } from "../lib/fileImportPlan.js";
import { isTauri } from "../ipc/env.js";
import { FrameIntake } from "../lib/FrameIntake.js";
import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { createLiveMeasurementOwner } from "./liveMeasurementOwner.js";

const MeterRuntimeContext = createContext(null);
const MeterRuntimeAssemblyContext = createContext(null);
/**
 * The display state that changes at human speed. Split from the assembly, whose value changes on
 * every meter frame, so a consumer that only raises a notice or reads the scrub position does not
 * re-render per frame.
 *
 * @typedef {{
 *   notice: ReturnType<typeof useMeterDisplay>["notice"],
 *   raiseNotice: ReturnType<typeof useMeterDisplay>["raiseNotice"],
 *   clearNotice: ReturnType<typeof useMeterDisplay>["clearNotice"],
 *   selectedOffset: number,
 *   setSelectedOffset: ReturnType<typeof useMeterDisplay>["setSelectedOffset"],
 *   selectSnapshot: ReturnType<typeof useMeterDisplay>["selectSnapshot"],
 *   clearSnapshot: ReturnType<typeof useMeterDisplay>["clearSnapshot"],
 *   selectedSnapshotTimeMs: number | null,
 *   showClock: boolean,
 * }} MeterDisplayState
 */
const MeterDisplayStateContext = createContext(/** @type {MeterDisplayState | null} */ (null));

/**
 * Owns the active-source state shared by Live and File. Engine hooks remain in
 * the private assembly seam with their shared refs; App consumes source state
 * and lifecycle verbs only through the public runtime interface.
 */
export function MeterRuntimeProvider({ children }) {
  const display = useMeterDisplay();
  const [sourceMode, setSourceMode] = useState("live");
  const sourceSelectionRef = useRef({ mode: "live", fileToken: null });
  const [preparingFileId, setPreparingFileId] = useState(null);
  const [stoppingFile, setStoppingFile] = useState(false);
  const [replacementTrackSelection, setReplacementTrackSelection] = useState(null);
  const preparationRef = useRef(null);
  const ledger = useFileSessionLedger({ protectedFileId: preparingFileId });
  const { fileHistory, fileSessions, activeFileSession, analyzingFileSession } = ledger;

  const liveIntakeRef = useRef(null);
  if (liveIntakeRef.current === null) liveIntakeRef.current = new FrameIntake();
  const liveMeasurementOwnerRef = useRef(null);
  if (liveMeasurementOwnerRef.current === null) {
    liveMeasurementOwnerRef.current = createLiveMeasurementOwner();
  }

  const transport = useCaptureTransport({
    display,
    getLiveIntake: () => liveIntakeRef.current,
  });
  const routing = useIntakeRouting({
    sourceMode,
    fileHistory,
    activeFileSession,
    analyzingFileSession,
    liveIntake: liveIntakeRef.current,
  });

  const audioRef = useRef(null);
  const defaultSampleRateRef = useRef(48000);
  const stopFileAnalysisRef = useRef(
    /** @type {(sessionId: string) => Promise<boolean | void>} */ (async () => {})
  );
  // Native File stop clears the shared source, so it keeps the transport reserved until it settles.
  const pendingFileStopRef = useRef(null);
  const clearingFilesRef = useRef(null);
  const fileAnalysisAcceptanceRef = useRef(new Map());
  const fileRequestInputsRef = useRef(null);
  const taskSessionRef = useRef(null);
  const liveClearPendingRef = useRef(false);
  const activeFileIdRef = useRef(null);
  useEffect(() => {
    activeFileIdRef.current = fileHistory.activeFileId;
  }, [fileHistory.activeFileId]);
  useEffect(() => {
    taskSessionRef.current = fileHistory.analyzingFileId;
  }, [fileHistory.analyzingFileId]);
  useEffect(
    () => () => {
      const preparation = preparationRef.current;
      if (!preparation) return;
      preparation.cancelled = true;
      preparation.cancelTrackSelection();
      void preparation.probeRequest?.cancel().catch(() => {});
    },
    []
  );
  const stopFileAnalysis = async (expectedSessionId) => {
    const pending = pendingFileStopRef.current;
    if (pending) {
      if (!expectedSessionId || expectedSessionId === pending.sessionId) await pending.promise;
      return;
    }
    const sessionId = taskSessionRef.current;
    if (!sessionId) return;
    if (expectedSessionId && expectedSessionId !== sessionId) return;
    const preparation = preparationRef.current;

    setStoppingFile(true);
    const promise = (async () => {
      try {
        if (preparation?.sessionId === sessionId) {
          if (preparation.probeRequest) await preparation.probeRequest.cancel();
          preparation.cancelled = true;
          preparation.cancelTrackSelection();
          preparationRef.current = null;
          setPreparingFileId(null);
          setReplacementTrackSelection(null);
          taskSessionRef.current = null;
          return;
        }
        const stopped = await stopFileAnalysisRef.current(sessionId);
        if (taskSessionRef.current === sessionId) taskSessionRef.current = null;
        if (stopped === false) return;
        ledger.markStopped(sessionId);
        display.clearNotice();
      } catch (error) {
        display.raiseNotice(
          "error",
          `Error: ${errorMessage(error, "Could not stop File analysis")}`,
          undefined,
          { requiresAttention: true, helpTopic: "file-analysis-stop" }
        );
        throw error;
      }
    })();
    pendingFileStopRef.current = { sessionId, promise };
    try {
      await promise;
    } finally {
      pendingFileStopRef.current = null;
      setStoppingFile(false);
    }
  };
  const startLiveForControl = async () => {
    const pending = pendingFileStopRef.current;
    if (pending) await pending.promise;
    if (taskSessionRef.current) throw new Error("File analysis already in progress");
    return transport.startLiveForControl();
  };
  const startLive = () => {
    if (pendingFileStopRef.current || taskSessionRef.current) {
      void stopFileAnalysis()
        .then(startLiveForControl)
        .catch(() => {});
    } else {
      transport.startLive();
    }
  };
  const switchSource = (/** @type {string} */ nextMode) => {
    if (nextMode === sourceSelectionRef.current.mode) return;
    sourceSelectionRef.current = {
      mode: nextMode,
      fileToken: nextMode === "file" ? Symbol() : null,
    };

    display.clearNotice();
    display.clearAudio();
    display.setSelectedOffset(-1);

    if (nextMode === "file") {
      if (transport.running) {
        transport.halt();
        display.clock.stopTimer();
      }
      setSourceMode("file");
      return;
    }

    if (taskSessionRef.current) {
      void stopFileAnalysis().catch(() => {});
    }
    setSourceMode("live");
    // The Live clear owed by a measurement-method change made while File was shown runs here, in
    // the business function, because a clear dispatched while File is shown removes the File.
    if (liveClearPendingRef.current) void clearLiveSource();
  };
  /** A measurement-method change while File is shown: clear Live once it is shown again. */
  const deferLiveClear = () => {
    liveClearPendingRef.current = true;
  };
  const clearLiveDisplay = () => {
    liveClearPendingRef.current = false;
    liveIntakeRef.current.reset();
    liveMeasurementOwnerRef.current.clear();
    transport.clearAudioDrop();
    if (sourceSelectionRef.current.mode === "live") {
      display.clearAudio();
      display.setSelectedOffset(-1);
      display.clock.resetTimer({ restart: transport.running });
      display.setShowClock(transport.running);
    }
  };
  const liveClearTarget = () => ({
    selection: sourceSelectionRef.current,
    meter: audioRef.current?.meter,
  });
  /** @param {{ strict?: boolean, target?: ReturnType<typeof liveClearTarget>, rules?: object }} [options] */
  const clearLiveSource = async ({ strict = false, target, rules } = {}) => {
    const meter = audioRef.current?.meter;
    const selection = sourceSelectionRef.current;
    try {
      if (target && (target.selection !== selection || target.meter !== meter)) {
        throw new Error("The Live source changed before the reset.");
      }
      if (isTauri() && (transport.lifecycle === "starting" || transport.lifecycle === "stopping")) {
        throw new Error("Wait for the Live source to finish changing.");
      }
      if (isTauri() && transport.running) {
        if (!meter || transport.lifecycle !== "running" || transport.deviceTransition) {
          throw new Error("Wait for the Live source to finish changing.");
        }
        await meter.resetMeter(
          "history",
          () => {
            if (sourceSelectionRef.current !== selection || audioRef.current?.meter !== meter) {
              throw new Error("The Live source changed before the reset.");
            }
            clearLiveDisplay();
          },
          rules
        );
      } else {
        clearLiveDisplay();
      }
      return true;
    } catch (error) {
      if (strict) throw error;
      if (sourceSelectionRef.current === selection) {
        display.raiseNotice("error", "Could not clear the Live measurement", error?.message, {
          requiresAttention: true,
        });
      }
      return false;
    }
  };
  const resetLiveTruePeakMax = async () => {
    const selection = sourceSelectionRef.current;
    const meter = audioRef.current?.meter;
    try {
      if (
        selection.mode !== "live" ||
        transport.lifecycle !== "running" ||
        transport.deviceTransition ||
        display.selectedOffsetRef.current >= 0 ||
        !meter
      ) {
        throw new Error("Reset True Peak Max is available during a Live measurement.");
      }
      await meter.resetMeter("truePeakMax", () => {
        if (sourceSelectionRef.current !== selection || audioRef.current?.meter !== meter) {
          throw new Error("The Live source changed before the reset.");
        }
        const nextAudio = { ...display.latestAudioRef.current, tpMax: -Infinity };
        if (display.selectedOffsetRef.current < 0) display.setAudio(nextAudio);
        else display.latestAudioRef.current = nextAudio;
        liveMeasurementOwnerRef.current.resetTruePeakMax();
      });
    } catch (error) {
      if (sourceSelectionRef.current === selection) {
        display.raiseNotice("error", "Could not reset True Peak Max", error?.message, {
          requiresAttention: true,
        });
      }
      throw error;
    }
  };
  const clearLiveForControl = (target, rules) => clearLiveSource({ strict: true, target, rules });
  const clearActiveSource = async () => {
    display.clearNotice();
    if (sourceSelectionRef.current.mode === "file") {
      const activeId = fileHistory.activeFileId;
      if (!activeId) return false;
      const activeEntry = fileHistory.sessionsById[activeId];
      if (
        fileHistory.analyzingFileId === activeId ||
        preparationRef.current?.sessionId === activeId
      ) {
        try {
          await stopFileAnalysis(activeId);
        } catch {
          // The stop operation already reports its failure in Status Notices.
          return false;
        }
      }
      activeEntry?.intake?.reset?.();
      display.clearAudio();
      display.setSelectedOffset(-1);
      ledger.remove(activeId);
      display.clock.resetTimer({ restart: false });
      display.setShowClock(false);
      return true;
    }

    return clearLiveSource();
  };
  const beginFileAnalysis = (
    path,
    analysisSettings,
    probe = null,
    existingId = null,
    activate = true
  ) => {
    if (!path || !sourceSelectionRef.current.fileToken) return null;
    display.clearNotice();
    if (
      fileHistory.analyzingFileId ||
      taskSessionRef.current ||
      pendingFileStopRef.current ||
      clearingFilesRef.current
    ) {
      display.raiseNotice("guard", "File analysis already in progress");
      return null;
    }

    if (activate) {
      display.clearSnapshot();
      if (sourceMode === "file") display.clearAudio();
    }
    if (existingId && fileHistory.sessionsById[existingId]) {
      ledger.rerun(existingId, path, analysisSettings, probe, "analyze", activate);
      taskSessionRef.current = existingId;
      return existingId;
    }
    const sessionId = ledger.beginRun(path, analysisSettings, probe, null, activate);
    taskSessionRef.current = sessionId;
    return sessionId;
  };
  const beginFileAnalysisForControl = (path, analysisSettings, probe = null, existingId = null) => {
    const sessionId = beginFileAnalysis(path, analysisSettings, probe, existingId);
    if (!sessionId) return null;
    const accepted = new Promise((resolve, reject) => {
      fileAnalysisAcceptanceRef.current.set(sessionId, { resolve, reject });
    });
    return { sessionId, accepted };
  };
  const reanalyzeFile = async (
    sessionId,
    analysisSettings,
    {
      onPrepared = null,
      kind = "analyze",
      selectReplacementTrack = null,
      beforeRun = null,
      signal = /** @type {AbortSignal | undefined} */ (undefined),
    } = {}
  ) => {
    signal?.throwIfAborted();
    const fileSourceToken = sourceSelectionRef.current.fileToken;
    if (!fileSourceToken) return null;
    analysisSettings = structuredClone(analysisSettings ?? {});
    display.clearNotice();
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry?.id || !entry.path) {
      display.raiseNotice("guard", "Choose a file to analyze");
      return false;
    }
    if (
      fileHistory.analyzingFileId ||
      taskSessionRef.current ||
      pendingFileStopRef.current ||
      clearingFilesRef.current
    ) {
      display.raiseNotice("guard", "File analysis already in progress");
      return false;
    }

    if (kind === "restore") {
      const successful = getSuccessfulFileSession(entry);
      if (!successful || !entry.historyReleased || !successful.metadata?.sourceVersion) {
        display.raiseNotice("guard", "History cannot be restored for this result");
        return false;
      }
      analysisSettings = structuredClone(successful.analysisSettings ?? {});
    }

    taskSessionRef.current = entry.id;
    const preparation = {
      sessionId: entry.id,
      cancelled: false,
      probeRequest: null,
      cancelTrackSelection: () => {},
    };
    const sourceStillSelected = () => sourceSelectionRef.current.fileToken === fileSourceToken;
    const preparationCurrent = () => !preparation.cancelled && sourceStillSelected();
    preparationRef.current = preparation;
    setPreparingFileId(entry.id);
    let probe = entry.metadata;
    let replaced = false;
    try {
      if (isTauri()) {
        preparation.probeRequest = signal
          ? startFileProbe(entry.path, { signal })
          : startFileProbe(entry.path);
        const discovered = await preparation.probeRequest.result.finally(() => {
          const stop = pendingFileStopRef.current;
          if (stop?.sessionId === entry.id) return stop.promise.catch(() => {});
        });
        preparation.probeRequest = null;
        if (!preparationCurrent()) return null;
        replaced = Boolean(
          entry.metadata?.sourceVersion &&
          !sameFileSourceVersion(entry.metadata.sourceVersion, discovered.sourceVersion)
        );
        if (replaced) {
          if (kind === "restore")
            throw new Error(
              "Source file changed; the original history cannot be restored. Reanalyze to create a new result."
            );
          if (fileImportTracks(discovered).length > 1) {
            if (selectReplacementTrack) probe = selectReplacementTrack(discovered);
            else {
              probe = await new Promise((resolve) => {
                preparation.cancelTrackSelection = () => resolve(null);
                setReplacementTrackSelection({
                  probe: discovered,
                  onConfirm: (index) => {
                    if (fileImportTracks(discovered).some((track) => track.index === index)) {
                      resolve(withSelectedAudioTrack(discovered, index));
                    }
                  },
                  onCancel: () => {
                    if (preparationRef.current === preparation) return stopFileAnalysis(entry.id);
                  },
                });
              });
              if (!probe || !preparationCurrent()) return null;
              setReplacementTrackSelection(null);
            }
          } else {
            probe = discovered;
          }
        } else {
          probe = withSelectedAudioTrack(
            discovered,
            entry.metadata?.selectedTrack?.index ?? discovered.selectedTrack.index
          );
        }
      }
      if (beforeRun) {
        try {
          await beforeRun();
        } catch (error) {
          if (!preparationCurrent()) return null;
          taskSessionRef.current = null;
          return Promise.reject(error);
        }
      }
      if (!preparationCurrent()) return null;
      signal?.throwIfAborted();
      const activate = activeFileIdRef.current === entry.id;
      if (activate && (replaced || !getSuccessfulFileSession(entry))) {
        display.clearSnapshot();
        display.clearAudio();
      }
      if (replaced) {
        const newId = ledger.beginRun(entry.path, analysisSettings, probe, onPrepared, activate);
        taskSessionRef.current = newId;
        return newId;
      }
      onPrepared?.(entry.id);
      ledger.rerun(entry.id, entry.path, analysisSettings, probe, kind);
      return entry.id;
    } catch (error) {
      if (!preparationCurrent()) return null;
      taskSessionRef.current = null;
      if (signal?.aborted) throw error;
      if (error?.reason === "fileTrackSelectionRequired") throw error;
      const message = errorMessage(error, "File is unavailable");
      if (kind === "analyze")
        ledger.updateSession(entry.id, (current) => ({
          ...current,
          state: "error",
          error: message,
        }));
      display.raiseNotice("error", `Error: ${message}`, undefined, {
        requiresAttention: true,
        helpTopic: "file-open-analysis",
      });
      return null;
    } finally {
      if (preparationRef.current === preparation) {
        if (!sourceStillSelected() && taskSessionRef.current === entry.id) {
          taskSessionRef.current = null;
        }
        preparationRef.current = null;
        setPreparingFileId(null);
        setReplacementTrackSelection(null);
      }
    }
  };
  const restoreFileHistory = (sessionId) => reanalyzeFile(sessionId, null, { kind: "restore" });
  const reanalyzeFileForControl = async (sessionId, analysisSettings, options = {}) => {
    let acceptance;
    const accepted = new Promise((resolve, reject) => {
      acceptance = { resolve, reject };
    });
    const resultId = await reanalyzeFile(sessionId, analysisSettings, {
      ...options,
      onPrepared: (id) => {
        fileAnalysisAcceptanceRef.current.set(id, acceptance);
      },
    });
    if (!resultId) return null;
    return { sessionId: resultId, accepted };
  };
  /**
   * @param {string} sessionId
   * @param {{ beforeRun?: (...args: any[]) => any, signal?: AbortSignal }} [options]
   */
  const restoreFileHistoryForControl = (sessionId, { beforeRun = null, signal } = {}) =>
    reanalyzeFileForControl(sessionId, null, { kind: "restore", beforeRun, signal });
  const selectFile = (sessionId) => {
    display.clearNotice();
    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    display.clearAudio();
    ledger.select(sessionId);
  };
  const resetFileDisplay = () => {
    display.clearAudio();
    display.setSelectedOffset(-1);
    display.clock.resetTimer({ restart: false });
    display.setShowClock(false);
  };
  const removeFile = async (sessionId) => {
    if (sourceSelectionRef.current.mode === "file") display.clearNotice();
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry) return false;
    const removedAnalyzingFile =
      fileHistory.analyzingFileId === sessionId || preparationRef.current?.sessionId === sessionId;

    if (removedAnalyzingFile) {
      await stopFileAnalysis();
      ledger.clearRunRequest();
    }
    entry.intake?.reset?.();
    const clearedDisplay =
      sourceSelectionRef.current.mode === "file" && activeFileIdRef.current === sessionId;
    if (clearedDisplay) resetFileDisplay();
    ledger.remove(sessionId);
    return clearedDisplay;
  };
  const clearFiles = async (afterStop) => {
    if (clearingFilesRef.current) return clearingFilesRef.current;
    const clearing = (async () => {
      if (sourceSelectionRef.current.mode === "file") display.clearNotice();
      await stopFileAnalysis();
      await afterStop?.();
      for (const entry of Object.values(fileHistory.sessionsById)) {
        entry.intake?.reset?.();
      }
      if (sourceSelectionRef.current.mode === "file") resetFileDisplay();
      ledger.clearAll();
    })();
    clearingFilesRef.current = clearing;
    try {
      await clearing;
    } finally {
      clearingFilesRef.current = null;
    }
  };

  // The verb closures above are recreated every render (they read current state
  // directly). Consumers get identity-stable forwarders instead, so the public
  // runtime object below can be memoized: without this, the provider re-renders
  // at meter-frame rate (display.audio lives here) and every useMeterRuntime
  // consumer would re-render ~30x/s even when its slice never changed. The ref
  // is written post-render (same pattern as useAppKeyboardShortcuts).
  const verbImpls = {
    startLive,
    stopLive: transport.stopLive,
    startLiveForControl,
    stopLiveForControl: transport.stopLiveForControl,
    stopLiveForCoordination: transport.stopLiveForCoordination,
    beginDeviceRestartForControl: transport.beginDeviceRestartForControl,
    stopFileAnalysis,
    switchSource,
    deferLiveClear,
    clearActiveSource,
    clearLiveForControl,
    liveClearTarget,
    resetLiveTruePeakMax,
    beginFileAnalysis,
    beginFileAnalysisForControl,
    reanalyzeFile,
    reanalyzeFileForControl,
    restoreFileHistory,
    restoreFileHistoryForControl,
    selectFile,
    removeFile,
    clearFiles,
  };
  const verbImplsRef = useRef(verbImpls);
  useEffect(() => {
    verbImplsRef.current = verbImpls;
  });
  const verbs = useMemo(() => {
    const forward =
      (/** @type {string} */ name) =>
      (/** @type {any} */ ...args) =>
        verbImplsRef.current[name](...args);
    return {
      startLive: forward("startLive"),
      stopLive: forward("stopLive"),
      startLiveForControl: forward("startLiveForControl"),
      stopLiveForControl: forward("stopLiveForControl"),
      stopLiveForCoordination: forward("stopLiveForCoordination"),
      beginDeviceRestartForControl: forward("beginDeviceRestartForControl"),
      stopFileAnalysis: forward("stopFileAnalysis"),
      switchSource: forward("switchSource"),
      deferLiveClear: forward("deferLiveClear"),
      clearActiveSource: forward("clearActiveSource"),
      clearLiveForControl: forward("clearLiveForControl"),
      liveClearTarget: forward("liveClearTarget"),
      resetLiveTruePeakMax: forward("resetLiveTruePeakMax"),
      beginFileAnalysis: forward("beginFileAnalysis"),
      beginFileAnalysisForControl: forward("beginFileAnalysisForControl"),
      reanalyzeFile: forward("reanalyzeFile"),
      reanalyzeFileForControl: forward("reanalyzeFileForControl"),
      restoreFileHistory: forward("restoreFileHistory"),
      restoreFileHistoryForControl: forward("restoreFileHistoryForControl"),
      selectFile: forward("selectFile"),
      removeFile: forward("removeFile"),
      clearFiles: forward("clearFiles"),
      getFileSourceToken: () => sourceSelectionRef.current.fileToken,
    };
  }, []);

  const runtime = useMemo(
    () => ({
      sourceMode,
      running: transport.running,
      liveLifecycle: transport.lifecycle,
      liveDeviceTransition: transport.deviceTransition,
      liveResolvedDeviceId: transport.resolvedDeviceId,
      liveStartedAt: transport.startedAt,
      liveLastError: transport.lastError,
      liveAudioDrop: transport.audioDrop,
      getLiveMeasurement: liveMeasurementOwnerRef.current.read,
      subscribeLiveMeasurement: liveMeasurementOwnerRef.current.subscribe,
      fileSessions,
      activeFileSession,
      analyzingFileSession,
      activeFileId: fileHistory.activeFileId,
      analyzingFileId: fileHistory.analyzingFileId,
      preparingFileId,
      replacementTrackSelection,
      fileTaskBusy: Boolean(preparingFileId || fileHistory.analyzingFileId || stoppingFile),
      ...verbs,
    }),
    [
      sourceMode,
      transport.running,
      transport.lifecycle,
      transport.deviceTransition,
      transport.resolvedDeviceId,
      transport.startedAt,
      transport.lastError,
      transport.audioDrop,
      fileSessions,
      activeFileSession,
      analyzingFileSession,
      fileHistory.activeFileId,
      fileHistory.analyzingFileId,
      preparingFileId,
      stoppingFile,
      replacementTrackSelection,
      verbs,
    ]
  );
  // Deliberately NOT memoized: its members (display/ledger/transport/routing)
  // change identity per render anyway, and its consumers are the ones that
  // work per frame: MeterRuntimeEngines, the display snapshot, the analysis
  // session and AppContent.
  const assembly = {
    display,
    sourceMode,
    ledger,
    transport,
    routing,
    liveIntakeRef,
    liveMeasurementOwner: liveMeasurementOwnerRef.current,
    audioRef,
    defaultSampleRateRef,
    stopFileAnalysisRef,
    fileAnalysisAcceptanceRef,
    fileRequestInputsRef,
  };

  const displayState = useMemo(
    () => ({
      notice: display.notice,
      raiseNotice: display.raiseNotice,
      clearNotice: display.clearNotice,
      selectedOffset: display.selectedOffset,
      setSelectedOffset: display.setSelectedOffset,
      selectSnapshot: display.selectSnapshot,
      clearSnapshot: display.clearSnapshot,
      selectedSnapshotTimeMs: display.selectedSnapshotTimeMs,
      showClock: display.showClock,
    }),
    [
      display.notice,
      display.raiseNotice,
      display.clearNotice,
      display.selectedOffset,
      display.setSelectedOffset,
      display.selectSnapshot,
      display.clearSnapshot,
      display.selectedSnapshotTimeMs,
      display.showClock,
    ]
  );

  return (
    <MeterRuntimeContext.Provider value={runtime}>
      <MeterRuntimeAssemblyContext.Provider value={assembly}>
        <MeterDisplayStateContext.Provider value={displayState}>
          {children}
        </MeterDisplayStateContext.Provider>
      </MeterRuntimeAssemblyContext.Provider>
    </MeterRuntimeContext.Provider>
  );
}

export function useMeterRuntime() {
  const runtime = useContext(MeterRuntimeContext);
  if (!runtime) throw new Error("useMeterRuntime must be used inside MeterRuntimeProvider");
  return runtime;
}

export function useMeterDisplayState() {
  const state = useContext(MeterDisplayStateContext);
  if (!state) throw new Error("useMeterDisplayState must be used inside MeterRuntimeProvider");
  return state;
}

export function useMeterRuntimeAssembly() {
  const assembly = useContext(MeterRuntimeAssemblyContext);
  if (!assembly) {
    throw new Error("useMeterRuntimeAssembly must be used inside MeterRuntimeProvider");
  }
  return assembly;
}
