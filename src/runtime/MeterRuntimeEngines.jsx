import { useEffect } from "react";
import { useAudioEngine } from "../hooks/useAudioEngine.js";
import { useFileAnalysisEngine } from "../hooks/useFileAnalysisEngine.js";
import { useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";

export function MeterRuntimeEngines({
  captureDeviceId,
  captureFormatSignature,
  histMaxSamples,
  visualMaxSamples,
  loudnessWeightsRef,
  dialogueGatingRef,
  dialogueVadEngineRef,
}) {
  const {
    display,
    sourceMode,
    ledger,
    transport,
    routing,
    liveIntakeRef,
    audioRef,
    defaultSampleRateRef,
    stopFileAnalysisRef,
  } = useMeterRuntimeAssembly();
  const { validRunRequest, updateSession, setAnalyzingFileId } = ledger;
  const { fileAnalysisIntake, fileDisplayActiveRef } = routing;

  const fileAnalysis = useFileAnalysisEngine({
    enabled: sourceMode === "file" && Boolean(validRunRequest),
    sessionId: validRunRequest?.sessionId ?? null,
    filePath: validRunRequest?.filePath ?? "",
    runId: validRunRequest?.runId ?? 0,
    histMaxSamples,
    visualMaxSamples,
    audioRef,
    defaultSampleRateRef,
    intake: fileAnalysisIntake,
    updateFileSession: updateSession,
    setAnalyzingFileId,
    display,
    shouldDriveDisplay: () => fileDisplayActiveRef.current,
  });

  useEffect(() => {
    stopFileAnalysisRef.current = fileAnalysis.stop;
    return () => {
      if (stopFileAnalysisRef.current === fileAnalysis.stop) {
        stopFileAnalysisRef.current = async () => {};
      }
    };
  }, [fileAnalysis.stop, stopFileAnalysisRef]);

  useAudioEngine({
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples,
    visualMaxSamples,
    audioRef,
    intake: liveIntakeRef.current,
    defaultSampleRateRef,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    transport,
    display,
  });

  return null;
}
