import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { normalizeAxisViewport } from "./axisViewports.js";

/**
 * The workspace's shared time axis as a window and an offset, with setters that accept a value or
 * an updater. Owns no state: it reads and writes the Workspace context, so any component may call
 * it.
 */
export function useSharedTimeViewport() {
  const { state: workspaceState, setAxisViewport } = useWorkspaceStore();

  const sharedTimeViewport = useMemo(
    () => normalizeAxisViewport("time", workspaceState.axisViewports?.time),
    [workspaceState.axisViewports?.time]
  );
  const sharedTimeViewportRef = useRef(sharedTimeViewport);
  useEffect(() => {
    sharedTimeViewportRef.current = sharedTimeViewport;
  }, [sharedTimeViewport]);
  const setHistoryWindowSec = useCallback(
    (nextWindowSec) => {
      const current = sharedTimeViewportRef.current;
      const windowSec =
        typeof nextWindowSec === "function" ? nextWindowSec(current.windowSec) : nextWindowSec;
      const next = { ...current, windowSec };
      sharedTimeViewportRef.current = next;
      setAxisViewport("time", next);
    },
    [setAxisViewport]
  );
  const setHistoryOffsetSec = useCallback(
    (nextOffsetSec) => {
      const current = sharedTimeViewportRef.current;
      const offsetSec =
        typeof nextOffsetSec === "function" ? nextOffsetSec(current.offsetSec) : nextOffsetSec;
      const next = { ...current, offsetSec };
      sharedTimeViewportRef.current = next;
      setAxisViewport("time", next);
    },
    [setAxisViewport]
  );

  return { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec };
}
