import { useCallback, useEffect, useRef, useState } from "react";
import { probeFileAnalysis } from "../ipc/commands.js";
import { sameFileSourceVersion, withSelectedAudioTrack } from "../lib/fileAnalysisSource.js";
import { fileImportTracks, planFileImport } from "../lib/fileImportPlan.js";

/** The queue owns pending imports. Once analysis starts, the File ledger owns the result. */
export function useFileImportQueue({
  enabled,
  busy,
  files,
  activeFileId,
  getSettings,
  begin,
  select,
  stop,
}) {
  const [items, setItems] = useState([]);
  const [commandSequence, setCommandSequence] = useState(0);
  const [selection, setSelection] = useState(null);
  const [current, setCurrent] = useState(null);
  const [sessionIds, setSessionIds] = useState(() => new Set());
  const [browsingResult, setBrowsingResult] = useState(false);
  const currentRef = useRef(null);
  const nextId = useRef(0);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const enqueue = useCallback(
    (paths, trackIndex = null, retryId = null) => {
      const settings = structuredClone(getSettings());
      const pending = [...new Set(paths)].filter(Boolean).map((path) => ({
        id: ++nextId.current,
        path,
        fileName: path.split(/[\\/]/).pop() || path,
        settings,
        state: "queued",
        probe: null,
        trackIndex,
        retryId,
        error: null,
      }));
      setItems((previous) => [
        ...previous,
        ...pending.filter(
          ({ path, retryId }) =>
            !previous.some(
              (item) =>
                (item.path === path || (retryId != null && item.retryId === retryId)) &&
                ["queued", "working", "track", "probed", "paused"].includes(item.state)
            )
        ),
      ]);
    },
    [getSettings]
  );

  function update(id, patch) {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function finish(task, patch) {
    if (currentRef.current !== task) return;
    currentRef.current = null;
    setCurrent(null);
    if (patch) update(task.id, patch);
    else setItems((previous) => previous.filter((item) => item.id !== task.id));
  }

  function cancel(batch = false) {
    if (batch) {
      setItems((previous) =>
        previous.map((item) =>
          ["queued", "probed"].includes(item.state) ? { ...item, state: "paused" } : item
        )
      );
    }
    const task = currentRef.current;
    if (!task) return;
    if (batch && !task.stopping && !task.canceled) task.resume = true;
    if (task.sessionId) {
      if (task.stopping) return;
      task.stopping = true;
      return stop(task.sessionId).catch((error) => {
        task.stopping = false;
        task.resume = false;
        throw error;
      });
    } else if (!task.canceled) {
      task.canceled = true;
      // A probe cannot be interrupted here. Keep its slot until it settles and ignore its result.
    }
  }

  const next = items.find((item) => item.state === "queued");
  const ready = items.find((item) => item.state === "probed");
  // The worker is driven by React's committed ledger state. Starting or settling a worker
  // publishes its UI state in the same turn, before another operation can take its slot.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) {
      setBrowsingResult(false);
      if (next || ready)
        setItems((previous) =>
          previous.map((item) =>
            ["queued", "probed"].includes(item.state) ? { ...item, state: "canceled" } : item
          )
        );
      if (currentRef.current && !currentRef.current.sessionId) currentRef.current.canceled = true;
      if (!busy && currentRef.current?.sessionId) finish(currentRef.current);
      setSelection(null);
      return;
    }
    const task = currentRef.current;
    if (task) {
      if (task.sessionId && busy) task.started = true;
      if (
        !busy &&
        task.sessionId &&
        (task.started || files.some((file) => file.id === task.sessionId))
      )
        finish(
          task,
          task.resume && files.find((file) => file.id === task.sessionId)?.runOutcome === "stopped"
            ? { state: "paused", retryId: task.sessionId }
            : null
        );
      return;
    }
    if (!next && !ready) setBrowsingResult(false);
    if (busy || !next || ready) return;

    const work = { id: next.id, canceled: false, sessionId: null };
    currentRef.current = work;
    setCurrent(work);
    update(next.id, { state: "working" });
    void probeFileAnalysis(next.path)
      .then((probe) => {
        if (work.canceled || !enabledRef.current) {
          finish(work, { state: work.resume ? "paused" : "canceled" });
          return;
        }
        // Revalidate queued track choices against the current source before starting analysis.
        if (
          next.trackIndex != null &&
          next.probe &&
          !sameFileSourceVersion(next.probe.sourceVersion, probe.sourceVersion)
        ) {
          finish(work, {
            state: fileImportTracks(probe).length > 1 ? "track" : "probed",
            trackIndex: null,
            probe,
          });
          return;
        }
        const selected =
          next.trackIndex == null ? probe : withSelectedAudioTrack(probe, next.trackIndex);
        finish(work, {
          state: next.trackIndex == null && fileImportTracks(probe).length > 1 ? "track" : "probed",
          probe: selected,
        });
      })
      .catch((error) => {
        finish(
          work,
          work.canceled || !enabledRef.current
            ? { state: work.resume ? "paused" : "canceled" }
            : {
                state: "error",
                error: error?.message || String(error || "File could not be opened"),
              }
        );
      });
    // Completion settles the exact task token. Launch uses current ledger state in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, busy, files, next, ready, current]);

  useEffect(() => {
    if (!enabled || busy || !ready || currentRef.current) return;
    const plan = planFileImport(files, ready.probe, ready.settings);
    const retry = ready.retryId != null && plan.sessionId === ready.retryId;
    if (plan.action === "select" && !retry) {
      if (!browsingResult || !activeFileId) select(plan.sessionId);
      setItems((previous) => previous.filter((item) => item.id !== ready.id));
      return;
    }
    const sessionId = begin(
      ready.probe.path,
      ready.settings,
      ready.probe,
      plan.sessionId,
      !browsingResult || !activeFileId
    );
    if (!sessionId) return;
    const task = { id: ready.id, sessionId, canceled: false, started: false, stopping: false };
    setSessionIds((previous) => new Set(previous).add(sessionId));
    currentRef.current = task;
    setCurrent(task);
    update(ready.id, {
      state: "working",
      trackIndex: ready.probe.selectedTrack.index,
      retryId: sessionId,
    });
  }, [enabled, busy, ready, files, activeFileId, browsingResult, begin, select]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function append(item) {
    setItems((previous) => [
      ...previous.filter(({ id }) => id !== item.id),
      { ...item, state: "queued", error: null },
    ]);
  }

  function confirmTrack(id, trackIndex) {
    const item = items.find((entry) => entry.id === id && entry.state === "track");
    if (!item || !fileImportTracks(item.probe).some((track) => track.index === trackIndex))
      return false;
    append({ ...item, trackIndex });
    if (selection?.id === id) setSelection(null);
    return true;
  }

  return {
    snapshot: {
      active: Boolean(current || next || ready),
      canResume: items.some((item) => item.state === "paused"),
      currentId: current?.id ?? null,
      commandSequence,
      items: items.map(({ id, path, fileName, state, probe, trackIndex, retryId, error }) => ({
        id,
        path,
        fileName,
        state,
        trackIndex,
        sessionId: retryId,
        error,
        tracks: state === "track" ? fileImportTracks(probe) : [],
      })),
    },
    acknowledgeCommand: () => setCommandSequence((sequence) => sequence + 1),
    items: items.filter((item) => !(item.id === current?.id && current.sessionId)),
    active: Boolean(current || next || ready),
    canResume: items.some((item) => item.state === "paused"),
    probing: Boolean(current && !current.sessionId),
    selection,
    sessionIds,
    onFileSelected: (id) => {
      const task = currentRef.current;
      if (task?.sessionId === id) setBrowsingResult(false);
      else if ((task || next || ready) && files.some((file) => file.id === id))
        setBrowsingResult(true);
    },
    enqueue,
    chooseTrack: (id) =>
      setSelection(items.find((item) => item.id === id && item.state === "track") ?? null),
    confirm: (trackIndex) => {
      if (selection) confirmTrack(selection.id, trackIndex);
    },
    confirmTrack,
    dismiss: () => setSelection(null),
    retry: (id) => {
      const item = items.find((entry) => entry.id === id);
      if (item && ["canceled", "error", "paused"].includes(item.state)) append(item);
    },
    retrySession: (session) =>
      enqueue([session.path], session.metadata?.selectedTrack?.index ?? null, session.id),
    remove: (id) => setItems((previous) => previous.filter((item) => item.id !== id)),
    stopCurrent: () => cancel(),
    cancelBatch: () => cancel(true),
    resumeBatch: () => {
      if (!currentRef.current && !next && !ready) {
        setItems((previous) =>
          previous.map((item) => (item.state === "paused" ? { ...item, state: "queued" } : item))
        );
      }
    },
    clear: () => {
      const task = currentRef.current;
      if (task && !task.sessionId) task.canceled = true;
      setItems([]);
      setSessionIds(new Set());
      setBrowsingResult(false);
      setSelection(null);
    },
  };
}
