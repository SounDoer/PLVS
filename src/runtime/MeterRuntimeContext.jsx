import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCaptureTransport } from "../hooks/useCaptureTransport.js";
import { useFileSessionLedger } from "../hooks/useFileSessionLedger.js";
import { useIntakeRouting } from "../hooks/useIntakeRouting.js";
import { useMeterDisplay } from "../hooks/useMeterDisplay.js";
import { clearAudioHistory, probeFileAnalysis } from "../ipc/commands.js";
import { sameFileSourceVersion, withSelectedAudioTrack } from "../lib/fileAnalysisSource.js";
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
  const [preparingFileId, setPreparingFileId] = useState(null);
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
  const stopFileAnalysisRef = useRef(async () => {});
  const fileAnalysisAcceptanceRef = useRef(new Map());
  const fileConditionsRef = useRef(null);
  const taskSessionRef = useRef(null);
  const liveClearPendingRef = useRef(false);
  const activeFileIdRef = useRef(null);
  useEffect(() => {
    activeFileIdRef.current = fileHistory.activeFileId;
  }, [fileHistory.activeFileId]);
  useEffect(() => {
    taskSessionRef.current = fileHistory.analyzingFileId;
  }, [fileHistory.analyzingFileId]);
  const stopFileAnalysis = async (expectedSessionId) => {
    const preparation = preparationRef.current;
    if (preparation && (!expectedSessionId || preparation.sessionId === expectedSessionId)) {
      preparation.cancelled = true;
      preparationRef.current = null;
      setPreparingFileId(null);
      taskSessionRef.current = null;
      return;
    }
    const sessionId = fileHistory.analyzingFileId;
    if (!sessionId) return;
    if (expectedSessionId && expectedSessionId !== sessionId) return;

    try {
      await stopFileAnalysisRef.current();
    } catch (error) {
      display.raiseNotice(
        "error",
        `Error: ${error?.message || "Could not stop File analysis"}`,
        undefined,
        { requiresAttention: true, helpTopic: "file-analysis-stop" }
      );
      throw error;
    }
    ledger.markStopped(sessionId);
    taskSessionRef.current = null;
    display.clearNotice();
  };
  const switchSource = (/** @type {string} */ nextMode) => {
    if (nextMode === sourceMode) return;

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

    if (fileHistory.analyzingFileId || preparationRef.current) {
      void stopFileAnalysis().catch(() => {});
    }
    setSourceMode("live");
    // The Live clear owed by a measurement-method change made while File was shown runs here, in
    // the business function, because a clear dispatched while File is shown removes the File.
    if (liveClearPendingRef.current) void clearLiveSource({ live: true }).catch(() => {});
  };
  /** A measurement-method change while File is shown: clear Live once it is shown again. */
  const deferLiveClear = () => {
    liveClearPendingRef.current = true;
  };
  /** @param {{ strict?: boolean, live?: boolean }} [options] */
  const clearLiveSource = async ({ strict = false, live = sourceMode === "live" } = {}) => {
    liveClearPendingRef.current = false;
    if (isTauri()) {
      try {
        await clearAudioHistory();
      } catch (error) {
        if (strict) throw error;
      }
    }
    liveIntakeRef.current.reset();
    liveMeasurementOwnerRef.current.clear();
    transport.clearAudioDrop();
    if (live) {
      display.clearAudio();
      display.setSelectedOffset(-1);
      display.clock.resetTimer({ restart: transport.running });
      display.setShowClock(transport.running);
    }
    return true;
  };
  const clearLiveForControl = () => clearLiveSource({ strict: true });
  const clearActiveSource = async () => {
    display.clearNotice();
    if (sourceMode === "file") {
      const activeId = fileHistory.activeFileId;
      if (!activeId) return false;
      const activeEntry = fileHistory.sessionsById[activeId];
      if (
        fileHistory.analyzingFileId === activeId ||
        preparationRef.current?.sessionId === activeId
      ) {
        await stopFileAnalysis();
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
    if (!path) return null;
    display.clearNotice();
    if (fileHistory.analyzingFileId || taskSessionRef.current) {
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
    onPrepared = null,
    kind = "analyze"
  ) => {
    analysisSettings = structuredClone(analysisSettings ?? {});
    display.clearNotice();
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry?.id || !entry.path) {
      display.raiseNotice("guard", "Choose a file to analyze");
      return false;
    }
    if (fileHistory.analyzingFileId || taskSessionRef.current) {
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
    const preparation = { sessionId: entry.id, cancelled: false };
    preparationRef.current = preparation;
    setPreparingFileId(entry.id);
    let probe = entry.metadata;
    try {
      if (isTauri()) {
        const discovered = await probeFileAnalysis(entry.path);
        if (preparation.cancelled) return null;
        probe = withSelectedAudioTrack(
          discovered,
          entry.metadata?.selectedTrack?.index ?? discovered.selectedTrack.index
        );
        if (
          entry.metadata?.sourceVersion &&
          !sameFileSourceVersion(entry.metadata.sourceVersion, probe.sourceVersion)
        ) {
          if (kind === "restore")
            throw new Error(
              "Source file changed; the original history cannot be restored. Reanalyze to create a new result."
            );
          const activate = activeFileIdRef.current === entry.id;
          if (activate) {
            display.clearSnapshot();
            display.clearAudio();
          }
          const newId = ledger.beginRun(entry.path, analysisSettings, probe, onPrepared, activate);
          taskSessionRef.current = newId;
          return newId;
        }
      }
      if (preparation.cancelled) return null;
      if (activeFileIdRef.current === entry.id && !getSuccessfulFileSession(entry)) {
        display.clearSnapshot();
        display.clearAudio();
      }
      onPrepared?.(entry.id);
      ledger.rerun(entry.id, entry.path, analysisSettings, probe, kind);
      return entry.id;
    } catch (error) {
      if (preparation.cancelled) return null;
      taskSessionRef.current = null;
      if (kind === "analyze")
        ledger.updateSession(entry.id, (current) => ({
          ...current,
          state: "error",
          error: error?.message || "File is unavailable",
        }));
      display.raiseNotice("error", `Error: ${error?.message || "File is unavailable"}`, undefined, {
        requiresAttention: true,
        helpTopic: "file-open-analysis",
      });
      return null;
    } finally {
      if (preparationRef.current === preparation) {
        preparationRef.current = null;
        setPreparingFileId(null);
      }
    }
  };
  const restoreFileHistory = (sessionId) => reanalyzeFile(sessionId, null, null, "restore");
  const reanalyzeFileForControl = async (sessionId, analysisSettings, kind = "analyze") => {
    let acceptance;
    const accepted = new Promise((resolve, reject) => {
      acceptance = { resolve, reject };
    });
    const resultId = await reanalyzeFile(
      sessionId,
      analysisSettings,
      (id) => {
        fileAnalysisAcceptanceRef.current.set(id, acceptance);
      },
      kind
    );
    if (!resultId) return null;
    return { sessionId: resultId, accepted };
  };
  const restoreFileHistoryForControl = (sessionId) =>
    reanalyzeFileForControl(sessionId, null, "restore");
  const selectFile = (sessionId) => {
    display.clearNotice();
    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    display.clearAudio();
    ledger.select(sessionId);
  };
  const removeFile = async (sessionId) => {
    display.clearNotice();
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry) return false;
    const removedAnalyzingFile =
      fileHistory.analyzingFileId === sessionId || preparationRef.current?.sessionId === sessionId;
    const clearedDisplay = fileHistory.activeFileId === sessionId || fileHistory.order.length <= 1;

    if (removedAnalyzingFile) {
      await stopFileAnalysis();
    }
    entry.intake?.reset?.();
    if (clearedDisplay) {
      display.clearAudio();
      display.setSelectedOffset(-1);
    }
    if (removedAnalyzingFile) {
      ledger.clearRunRequest();
    }
    ledger.remove(sessionId);
    display.clock.resetTimer({ restart: false });
    display.setShowClock(false);
    return clearedDisplay;
  };
  const clearFiles = async () => {
    display.clearNotice();
    if (fileHistory.analyzingFileId || preparationRef.current) {
      await stopFileAnalysis();
    }
    for (const entry of Object.values(fileHistory.sessionsById)) {
      entry.intake?.reset?.();
    }
    display.clearAudio();
    display.setSelectedOffset(-1);
    ledger.clearAll();
    display.clock.resetTimer({ restart: false });
    display.setShowClock(false);
  };

  // The verb closures above are recreated every render (they read current state
  // directly). Consumers get identity-stable forwarders instead, so the public
  // runtime object below can be memoized: without this, the provider re-renders
  // at meter-frame rate (display.audio lives here) and every useMeterRuntime
  // consumer would re-render ~30x/s even when its slice never changed. The ref
  // is written post-render (same pattern as useAppKeyboardShortcuts).
  const verbImpls = {
    startLive: transport.startLive,
    stopLive: transport.stopLive,
    startLiveForControl: transport.startLiveForControl,
    stopLiveForControl: transport.stopLiveForControl,
    beginDeviceRestartForControl: transport.beginDeviceRestartForControl,
    stopFileAnalysis,
    switchSource,
    deferLiveClear,
    clearActiveSource,
    clearLiveForControl,
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
      beginDeviceRestartForControl: forward("beginDeviceRestartForControl"),
      stopFileAnalysis: forward("stopFileAnalysis"),
      switchSource: forward("switchSource"),
      deferLiveClear: forward("deferLiveClear"),
      clearActiveSource: forward("clearActiveSource"),
      clearLiveForControl: forward("clearLiveForControl"),
      beginFileAnalysis: forward("beginFileAnalysis"),
      beginFileAnalysisForControl: forward("beginFileAnalysisForControl"),
      reanalyzeFile: forward("reanalyzeFile"),
      reanalyzeFileForControl: forward("reanalyzeFileForControl"),
      restoreFileHistory: forward("restoreFileHistory"),
      restoreFileHistoryForControl: forward("restoreFileHistoryForControl"),
      selectFile: forward("selectFile"),
      removeFile: forward("removeFile"),
      clearFiles: forward("clearFiles"),
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
      fileTaskBusy: Boolean(preparingFileId || fileHistory.analyzingFileId),
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
    fileConditionsRef,
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
