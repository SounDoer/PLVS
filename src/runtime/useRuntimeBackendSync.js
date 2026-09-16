import { useCallback, useEffect, useRef } from "react";
import {
  setAnalysisRequests,
  setDialogueGating,
  setDialogueVadEngine,
  setChannelRoles,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useRuntimeBackendSync({
  analysisRequests,
  channelRoles,
  dialogueGating,
  dialogueVadEngine,
}) {
  const lastSentAnalysisRequestsKeyRef = useRef("");
  const channelRolesRef = useRef(channelRoles);
  const dialogueGatingRef = useRef(dialogueGating);
  const dialogueVadEngineRef = useRef(dialogueVadEngine);

  useEffect(() => {
    channelRolesRef.current = channelRoles;
    if (!isTauri()) return;
    // File analysis snapshots the native selection when its worker starts, so roles must stay
    // synchronized even while Live capture is stopped.
    void setChannelRoles(channelRoles).catch(() => {});
  }, [channelRoles]);

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

  const setChannelRolesForControl = useCallback(async (nextRoles) => {
    if (isTauri()) await setChannelRoles(nextRoles);
    channelRolesRef.current = nextRoles;
  }, []);

  const setDialogueVadEngineForControl = useCallback(async (nextEngine) => {
    if (isTauri()) await setDialogueVadEngine(nextEngine);
    dialogueVadEngineRef.current = nextEngine;
  }, []);

  return {
    channelRolesRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    setChannelRolesForControl,
    setDialogueVadEngineForControl,
  };
}
