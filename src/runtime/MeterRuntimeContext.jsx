import { createContext, useContext, useRef, useState } from "react";
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
      display.setStatus("File analysis stopped");
    }
  };
  const switchSource = (nextMode) => {
    if (nextMode === sourceMode) return;

    display.clearAudio();
    display.setSelectedOffset(-1);
    liveIntakeRef.current.reset();

    if (nextMode === "file") {
      if (transport.running) {
        transport.halt();
        display.clock.stopTimer();
        display.setStatus("Stopped live monitoring - file mode selected");
        display.setStatus2("Device: Not connected");
      } else {
        display.setStatus("File mode - drop a file or click Analyze");
      }
      setSourceMode("file");
      return;
    }

    if (fileHistory.analyzingFileId) {
      void stopFileAnalysis();
    }
    setSourceMode("live");
    display.setStatus("Ready - click Start to begin monitoring");
    display.setStatus2("Device: Not connected");
  };
  const clearActiveSource = async () => {
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
      display.setStatus(
        fileHistory.order.length > 1
          ? "File entry cleared"
          : "File mode - drop a file or click Analyze"
      );
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
    display.setStatus(
      transport.running
        ? "Running - cleared history and peak hold"
        : "Ready - click Start to begin monitoring"
    );
    display.clock.resetTimer({ restart: transport.running });
    display.setShowClock(transport.running);
    return true;
  };
  const beginFileAnalysis = (path, analysisSettings) => {
    if (!path) return null;
    if (fileHistory.analyzingFileId) {
      display.setStatus("File analysis already in progress");
      return null;
    }

    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    return ledger.beginRun(path, analysisSettings);
  };
  const reanalyzeFile = (sessionId, analysisSettings) => {
    const entry = fileHistory.sessionsById[sessionId];
    if (!entry?.id || !entry.path) {
      display.setStatus("Choose a file to analyze");
      return false;
    }
    if (fileHistory.analyzingFileId) {
      display.setStatus("File analysis already in progress");
      return false;
    }

    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    ledger.rerun(entry.id, entry.path, analysisSettings);
    return true;
  };
  const selectFile = (sessionId) => {
    display.setSelectedOffset(-1);
    display.selectedOffsetRef.current = -1;
    display.clearAudio();
    ledger.select(sessionId);
    display.setStatus("File analysis result");
  };
  const removeFile = async (sessionId) => {
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
    display.setStatus(
      fileHistory.order.length > 1
        ? "File entry removed"
        : "File mode - drop a file or click Analyze"
    );
    display.clock.resetTimer({ restart: false });
    display.setShowClock(false);
    return clearedDisplay;
  };
  const clearFiles = async () => {
    if (fileHistory.analyzingFileId) {
      await stopFileAnalysis();
    }
    for (const entry of Object.values(fileHistory.sessionsById)) {
      entry.intake?.reset?.();
    }
    display.clearAudio();
    display.setSelectedOffset(-1);
    ledger.clearAll();
    display.setStatus("File mode - drop a file or click Analyze");
    display.clock.resetTimer({ restart: false });
    display.setShowClock(false);
  };

  const runtime = {
    sourceMode,
    running: transport.running,
    fileSessions,
    activeFileSession,
    analyzingFileSession,
    activeFileId: fileHistory.activeFileId,
    analyzingFileId: fileHistory.analyzingFileId,
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
