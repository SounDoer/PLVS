import { createContext, useContext, useRef, useState } from "react";
import { useCaptureTransport } from "../hooks/useCaptureTransport.js";
import { useFileSessionLedger } from "../hooks/useFileSessionLedger.js";
import { useIntakeRouting } from "../hooks/useIntakeRouting.js";
import { useMeterDisplay } from "../hooks/useMeterDisplay.js";
import { FrameIntake } from "../lib/FrameIntake.js";

const MeterRuntimeContext = createContext(null);
const MeterRuntimeAssemblyContext = createContext(null);

/**
 * Owns the active-source state shared by Live and File. Engine hooks remain in
 * App during the phase-4b migration; the assembly context is temporary and
 * disappears once both engine adapters move behind this module's public seam.
 */
export function MeterRuntimeProvider({ children }) {
  const display = useMeterDisplay();
  const [sourceMode, setSourceMode] = useState("live");
  const ledger = useFileSessionLedger();
  const { fileHistory, activeFileSession, analyzingFileSession } = ledger;

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
  const stopFileAnalysis = async () => {
    const sessionId = fileHistory.analyzingFileId;
    if (!sessionId) return;

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

  const runtime = {
    sourceMode,
    running: transport.running,
    startLive: transport.startLive,
    stopLive: transport.stopLive,
    stopFileAnalysis,
    switchSource,
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
