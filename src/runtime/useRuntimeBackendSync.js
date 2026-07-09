import { useEffect, useRef } from "react";
import {
  setAnalysisRequests,
  setDialogueGating,
  setDialogueVadEngine,
  setLoudnessWeights,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useRuntimeBackendSync({
  analysisRequests,
  loudnessWeights,
  running,
  dialogueGating,
  dialogueVadEngine,
}) {
  const lastSentAnalysisRequestsKeyRef = useRef("");
  const loudnessWeightsRef = useRef(loudnessWeights);
  const dialogueGatingRef = useRef(dialogueGating);
  const dialogueVadEngineRef = useRef(dialogueVadEngine);

  useEffect(() => {
    loudnessWeightsRef.current = loudnessWeights;
    if (!isTauri() || !running) return;
    void setLoudnessWeights(loudnessWeights).catch(() => {});
  }, [loudnessWeights, running]);

  useEffect(() => {
    dialogueGatingRef.current = dialogueGating;
    if (!isTauri()) return;
    void setDialogueGating(dialogueGating);
  }, [dialogueGating]);

  useEffect(() => {
    dialogueVadEngineRef.current = dialogueVadEngine;
    if (!isTauri()) return;
    void setDialogueVadEngine(dialogueVadEngine);
  }, [dialogueVadEngine]);

  useEffect(() => {
    if (!isTauri()) {
      lastSentAnalysisRequestsKeyRef.current = "";
      return;
    }
    // Sync request keys whenever they change, not only during live capture. The file analysis
    // worker snapshots these at start, so a fresh launch can analyze files before live capture.
    const key = JSON.stringify(analysisRequests);
    if (lastSentAnalysisRequestsKeyRef.current === key) return;
    lastSentAnalysisRequestsKeyRef.current = key;
    void setAnalysisRequests(analysisRequests).catch(() => {
      if (lastSentAnalysisRequestsKeyRef.current === key) {
        lastSentAnalysisRequestsKeyRef.current = "";
      }
    });
  }, [analysisRequests]);

  return {
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
  };
}
