import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { probeFileAnalysis } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
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
  const generationRef = useRef(0);
  const cancel = useCallback(() => {
    generationRef.current += 1;
    pendingRef.current = null;
    setSelection(null);
    setImportBusy(false);
  }, []);
  const launch = useCallback(
    (probe, settings) => {
      const plan = planFileImport(files, probe, settings);
      if (plan.action === "select") select(plan.sessionId);
      else if (plan.action === "rerun") begin(probe.path, settings, probe, plan.sessionId);
      else begin(probe.path, settings, probe);
      cancel();
    },
    [files, select, begin, cancel]
  );
  const latest = useRef({ busy, launch });
  useLayoutEffect(() => {
    latest.current = { busy, launch };
  }, [busy, launch]);

  const inspectAndLaunch = useCallback(
    async (path, settings, sourceToken, index = null, previousProbe = null) => {
      const generation = ++generationRef.current;
      pendingRef.current = { generation };
      setImportBusy(true);
      try {
        const probe = await probeFileAnalysis(path);
        if (generation !== generationRef.current) return;
        if (sourceToken !== getFileSourceToken()) return cancel();
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
          cancel();
          raiseNotice("guard", "File analysis already in progress");
        } else {
          latest.current.launch(track.probe, settings);
        }
      } catch (error) {
        if (generation !== generationRef.current) return;
        cancel();
        if (sourceToken !== getFileSourceToken()) return;
        raiseNotice("error", `Error: ${error?.message || "File could not be opened"}`, undefined, {
          requiresAttention: true,
          helpTopic: "file-open-analysis",
        });
      }
    },
    [cancel, getFileSourceToken, raiseNotice]
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
