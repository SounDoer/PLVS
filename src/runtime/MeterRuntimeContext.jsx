import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCaptureTransport } from "../hooks/useCaptureTransport.js";
import { useFileSessionLedger } from "../hooks/useFileSessionLedger.js";
import { useIntakeRouting } from "../hooks/useIntakeRouting.js";
import { useMeterDisplay } from "../hooks/useMeterDisplay.js";
import { clearAudioHistory } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { FrameIntake } from "../lib/FrameIntake.js";

const MeterRuntimeContext = createContext(null);
const MeterRuntimeAssemblyContext = createContext(null);

/**
 * Owns the active-source state shared by Live and File. Engine hooks remain in
 * the private assembly seam with their shared refs; App consumes source state
 * and lifecycle verbs only through the public runtime interface.
 */
export function MeterRuntimeProvider({ children }) {
  const display = useMeterDisplay();
  const [sourceMode, setSourceMode] = useState("live");
  const ledger = useFileSessionLedger();
  const { fileHistory, fileSessions, activeFileSession, analyzingFileSession } = ledger;

  const liveIntakeRef = useRef(null);
  if (liveIntakeRef.current === null) liveIntakeRef.current = new FrameIntake();

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
  const stopFileAnalysis = async (expectedSessionId) => {
    const sessionId = fileHistory.analyzingFileId;
    if (!sessionId) return;
    if (expectedSessionId && expectedSessionId !== sessionId) return;

    try {
      await stopFileAnalysisRef.current();
    } finally {
      ledger.markStopped(sessionId);
      display.clearNotice();
    }
  };
  const switchSource = (nextMode) => {
    if (nextMode === sourceMode) return;

    display.clearNotice();
    display.clearAudio();
    display.setSelectedOffset(-1);
    liveIntakeRef.current.reset();

    if (nextMode === "file") {
      if (transport.running) {
        transport.halt();
        display.clock.stopTimer();
      }
      setSourceMode("file");
      return;
    }

    if (fileHistory.analyzingFileId) {
      void stopFileAnalysis();
    }
    setSourceMode("live");
  };
  const clearActiveSource = async () => {
    display.clearNotice();
    if (sourceMode === "file") {
      const activeId = fileHistory.activeFileId;
      if (!activeId) return false;
      const activeEntry = fileHistory.sessionsById[activeId];
      if (fileHistory.analyzingFileId === activeId) {
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

    if (isTauri()) {
      try {
        await clearAudioHistory();
      } catch (_) {}
    }
    routing.intakeRef.current.reset();
    display.clearAudio();
    display.setSelectedOffset(-1);
    display.clock.resetTimer({ restart: transport.running });
    display.setShowClock(transport.running);
    return true;
  };
  const beginFileAnalysis = (path, analysisSettings) => {
    if (!path) return null;
    display.clearNotice();
    if (fileHistory.analyzingFileId) {
      display.raiseNotice("guard", "File analysis already in progress");
      return null;
    }

    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    return ledger.beginRun(path, analysisSettings);
  };
  const reanalyzeFile = (sessionId, analysisSettings) => {
    display.clearNotice();
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry?.id || !entry.path) {
      display.raiseNotice("guard", "Choose a file to analyze");
      return false;
    }
    if (fileHistory.analyzingFileId) {
      display.raiseNotice("guard", "File analysis already in progress");
      return false;
    }

    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    ledger.rerun(entry.id, entry.path, analysisSettings);
    return true;
  };
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
    const removedAnalyzingFile = fileHistory.analyzingFileId === sessionId;
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
    if (fileHistory.analyzingFileId) {
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
    stopFileAnalysis,
    switchSource,
    clearActiveSource,
    beginFileAnalysis,
    reanalyzeFile,
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
      (name) =>
      (...args) =>
        verbImplsRef.current[name](...args);
    return {
      startLive: forward("startLive"),
      stopLive: forward("stopLive"),
      stopFileAnalysis: forward("stopFileAnalysis"),
      switchSource: forward("switchSource"),
      clearActiveSource: forward("clearActiveSource"),
      beginFileAnalysis: forward("beginFileAnalysis"),
      reanalyzeFile: forward("reanalyzeFile"),
      selectFile: forward("selectFile"),
      removeFile: forward("removeFile"),
      clearFiles: forward("clearFiles"),
    };
  }, []);

  const runtime = useMemo(
    () => ({
      sourceMode,
      running: transport.running,
      fileSessions,
      activeFileSession,
      analyzingFileSession,
      activeFileId: fileHistory.activeFileId,
      analyzingFileId: fileHistory.analyzingFileId,
      ...verbs,
    }),
    [
      sourceMode,
      transport.running,
      fileSessions,
      activeFileSession,
      analyzingFileSession,
      fileHistory.activeFileId,
      fileHistory.analyzingFileId,
      verbs,
    ]
  );
  // Deliberately NOT memoized: its members (display/ledger/transport/routing)
  // change identity per render anyway, and its only consumer is the
  // null-rendering MeterRuntimeEngines.
  const assembly = {
    display,
    sourceMode,
    ledger,
    transport,
    routing,
    liveIntakeRef,
    audioRef,
    defaultSampleRateRef,
    stopFileAnalysisRef,
  };

  return (
    <MeterRuntimeContext.Provider value={runtime}>
      <MeterRuntimeAssemblyContext.Provider value={assembly}>
        {children}
      </MeterRuntimeAssemblyContext.Provider>
    </MeterRuntimeContext.Provider>
  );
}

export function useMeterRuntime() {
  const runtime = useContext(MeterRuntimeContext);
  if (!runtime) throw new Error("useMeterRuntime must be used inside MeterRuntimeProvider");
  return runtime;
}

export function useMeterRuntimeAssembly() {
  const assembly = useContext(MeterRuntimeAssemblyContext);
  if (!assembly) {
    throw new Error("useMeterRuntimeAssembly must be used inside MeterRuntimeProvider");
  }
  return assembly;
}
