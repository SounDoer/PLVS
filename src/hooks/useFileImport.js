import { useCallback, useRef, useState } from "react";
import { probeFileAnalysis } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { withSelectedAudioTrack } from "../lib/fileAnalysisSource.js";
import { fileImportTracks, planFileImport } from "../lib/fileImportPlan.js";

/** Import selection is transient; it never changes an existing result before confirmation. */
export function useFileImport({ files, busy, getSettings, begin, select, raiseNotice }) {
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
      const generation = ++generationRef.current;
      pendingRef.current = { generation };
      setImportBusy(true);
      try {
        const probe = await probeFileAnalysis(path);
        if (generation !== generationRef.current) return;
        if (fileImportTracks(probe).length > 1) {
          const next = { probe, settings };
          pendingRef.current = next;
          setSelection(next);
          setImportBusy(false);
        } else launch(probe, settings);
      } catch (error) {
        if (generation !== generationRef.current) return;
        cancel();
        raiseNotice("error", `Error: ${error?.message || "File could not be opened"}`, undefined, {
          requiresAttention: true,
        });
      }
    },
    [busy, getSettings, begin, launch, cancel, raiseNotice]
  );
  const confirm = useCallback(
    (index) => {
      if (!selection || busy) return;
      launch(withSelectedAudioTrack(selection.probe, index), selection.settings);
    },
    [selection, busy, launch]
  );
  return { importFile, importBusy, selection, cancel, confirm };
}
