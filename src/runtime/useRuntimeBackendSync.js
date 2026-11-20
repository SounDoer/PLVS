import { useCallback, useEffect, useRef } from "react";
import { setAnalysisRequests } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useRuntimeBackendSync({
  analysisRequests,
  channelRoles,
  dialogueGating,
  dialogueVadEngine,
  running,
  ready,
  channelCount,
  clearLiveForControl,
  liveClearTarget,
  deferLiveClear,
  resetLiveDisplayControls,
  raiseNotice,
}) {
  const lastSentAnalysisRequestsKeyRef = useRef("");
  const channelRolesRef = useRef(channelRoles);
  const dialogueGatingRef = useRef(dialogueGating);
  const dialogueVadEngineRef = useRef(dialogueVadEngine);

  const scopeRef = useRef(null);
  const rulesTail = useRef(Promise.resolve());
  const applyMeasurementRules = useCallback(
    (patch, target = liveClearTarget()) => {
      const work = rulesTail.current.then(async () => {
        const current = liveClearTarget();
        if (current.selection !== target.selection || current.meter !== target.meter) {
          throw new Error("The Live source changed before applying measurement settings.");
        }
        const previous = {
          channelRoles: channelRolesRef.current,
          dialogueGating: dialogueGatingRef.current,
          dialogueVadEngine: dialogueVadEngineRef.current,
        };
        const next = { ...previous, ...patch };
        // An unused detector choice has no effect on this measurement. The next run or the
        // change that enables detection will send the complete rules, including this choice.
        const measurementChanged =
          JSON.stringify(next.channelRoles) !== JSON.stringify(previous.channelRoles) ||
          next.dialogueGating !== previous.dialogueGating ||
          (next.dialogueGating && next.dialogueVadEngine !== previous.dialogueVadEngine);
        let reset = false;
        if (measurementChanged && current.selection.mode === "live") {
          await clearLiveForControl(target, next);
          resetLiveDisplayControls(target);
          reset = true;
        } else if (measurementChanged) {
          deferLiveClear();
        }
        scopeRef.current = { meter: current.meter, key: JSON.stringify(next) };
        channelRolesRef.current = next.channelRoles;
        dialogueGatingRef.current = next.dialogueGating;
        dialogueVadEngineRef.current = next.dialogueVadEngine;
        return reset;
      });
      rulesTail.current = work.then(
        () => {},
        () => {}
      );
      return work;
    },
    [clearLiveForControl, liveClearTarget, deferLiveClear, resetLiveDisplayControls]
  );

  const channelRolesKey = JSON.stringify(channelRoles);
  useEffect(() => {
    const target = liveClearTarget();
    const roles =
      running && channelCount === 0 ? channelRolesRef.current : JSON.parse(channelRolesKey);
    const next = { channelRoles: roles, dialogueGating, dialogueVadEngine };
    const key = JSON.stringify(next);
    if (!running || !isTauri()) {
      channelRolesRef.current = roles;
      dialogueGatingRef.current = dialogueGating;
      dialogueVadEngineRef.current = dialogueVadEngine;
      scopeRef.current = { meter: target.meter, key };
      return;
    }
    if (!ready || !target.meter || target.selection.mode !== "live") return;
    if (
      scopeRef.current?.meter !== target.meter &&
      JSON.stringify({
        channelRoles: channelRolesRef.current,
        dialogueGating: dialogueGatingRef.current,
        dialogueVadEngine: dialogueVadEngineRef.current,
      }) === key
    ) {
      scopeRef.current = { meter: target.meter, key };
      return;
    }
    if (scopeRef.current?.meter === target.meter && scopeRef.current.key === key) return;
    void applyMeasurementRules(next, target).catch((error) => {
      if (liveClearTarget().selection === target.selection) {
        raiseNotice("error", "Could not apply the Live measurement settings", error?.message, {
          requiresAttention: true,
        });
      }
    });
  }, [
    channelRolesKey,
    channelCount,
    running,
    ready,
    dialogueGating,
    dialogueVadEngine,
    applyMeasurementRules,
    liveClearTarget,
    raiseNotice,
  ]);

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
    channelRolesRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    applyMeasurementRules,
  };
}
