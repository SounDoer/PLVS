import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { startFileProbe } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { errorDetails, errorMessage } from "../lib/errorDetails.js";
import { planFileImport, revalidateFileTrack } from "../lib/fileImportPlan.js";

/** Import selection is transient; it never changes an existing result before confirmation. */
export function useFileImport({
  files,
  busy,
  getSettings,
  begin,
  select,
  raiseNotice,
  getFileSourceToken = () => undefined,
}) {
  const [selection, setSelection] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const pendingRef = useRef(null);
  const reset = useCallback(() => {
    pendingRef.current = null;
    setSelection(null);
    setImportBusy(false);
  }, []);
  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending?.request) {
      reset();
      return Promise.resolve();
    }
    pending.cancellation ??= pending.request
      .cancel()
      .then(() => {
        if (pendingRef.current === pending) reset();
      })
      .catch((error) => {
        if (pendingRef.current === pending && pending.sourceToken === getFileSourceToken()) {
          raiseNotice("error", errorDetails("Could not stop File probing", error), undefined, {
            requiresAttention: true,
            helpTopic: "file-analysis-stop",
          });
        }
        throw error;
      })
      .finally(() => {
        pending.cancellation = null;
      });
    return pending.cancellation;
  }, [getFileSourceToken, raiseNotice, reset]);
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      void pending?.request?.cancel().catch(() => {});
    },
    []
  );
  const launch = useCallback(
    (probe, settings) => {
      const plan = planFileImport(files, probe, settings);
      if (plan.action === "select") select(plan.sessionId);
      else if (plan.action === "rerun") begin(probe.path, settings, probe, plan.sessionId);
      else begin(probe.path, settings, probe);
      reset();
    },
    [files, select, begin, reset]
  );
  const latest = useRef({ busy, launch });
  useLayoutEffect(() => {
    latest.current = { busy, launch };
  }, [busy, launch]);

  const inspectAndLaunch = useCallback(
    async (path, settings, sourceToken, index = null, previousProbe = null) => {
      const request = startFileProbe(path);
      const pending = { request, sourceToken, cancellation: null };
      pendingRef.current = pending;
      setImportBusy(true);
      try {
        const probe = await request.result.finally(() => pending.cancellation?.catch(() => {}));
        if (pendingRef.current !== pending) return;
        if (sourceToken !== getFileSourceToken()) return reset();
        const track = revalidateFileTrack(probe, index, previousProbe);
        if (track.requiresTrackSelection || (previousProbe && latest.current.busy)) {
          const next = {
            probe: track.probe,
            settings,
            sourceToken,
            sourceChanged: track.sourceChanged,
          };
          pendingRef.current = next;
          setSelection(next);
          setImportBusy(false);
        } else if (latest.current.busy) {
          reset();
          raiseNotice("guard", "File analysis already in progress");
        } else {
          latest.current.launch(track.probe, settings);
        }
      } catch (error) {
        if (pendingRef.current !== pending) return;
        reset();
        if (sourceToken !== getFileSourceToken()) return;
        raiseNotice(
          "error",
          `Error: ${errorMessage(error, "File could not be opened")}`,
          undefined,
          {
            requiresAttention: true,
            helpTopic: "file-open-analysis",
          }
        );
      }
    },
    [getFileSourceToken, raiseNotice, reset]
  );

  const importFile = useCallback(
    async (path) => {
      if (!path) return;
      if (busy || pendingRef.current) {
        raiseNotice("guard", "File analysis already in progress");
        return;
      }
      const settings = structuredClone(getSettings());
      if (!isTauri()) {
        begin(path, settings);
        return;
      }
      await inspectAndLaunch(path, settings, getFileSourceToken());
    },
    [busy, getSettings, begin, inspectAndLaunch, raiseNotice, getFileSourceToken]
  );

  const confirm = useCallback(
    (index) => {
      if (!selection || busy || pendingRef.current !== selection) return;
      if (selection.sourceToken !== getFileSourceToken()) return cancel();
      setSelection({ ...selection, busy: true });
      return inspectAndLaunch(
        selection.probe.path,
        selection.settings,
        selection.sourceToken,
        index,
        selection.probe
      );
    },
    [selection, busy, cancel, getFileSourceToken, inspectAndLaunch]
  );
  return { importFile, importBusy, selection, cancel, confirm };
}
