import { useCallback, useRef, useState } from "react";
import { enterDock, exitDock, setDockReserveSpace } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { presetsStore } from "../persistence/index.js";

function normalizeDockState(raw) {
  const edge = raw?.edge === "top" ? "top" : "bottom";
  return { enabled: raw?.enabled === true, edge, reserveSpace: raw?.reserveSpace !== false };
}

/**
 * Dock window-form state. Rust owns geometry + the persisted dockState key;
 * this hook mirrors it for rendering and drives enter/exit transitions.
 * Attribute restores (decorations / always-on-top) are passed by the caller so
 * stored user settings are never rewritten by the dock override.
 */
export function useDockMode() {
  const [dock, setDock] = useState(() =>
    normalizeDockState(
      typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__?.dockState : undefined
    )
  );
  const dockRef = useRef(dock);
  const transitionTailRef = useRef(Promise.resolve());

  const commitDock = useCallback((update) => {
    const next = typeof update === "function" ? update(dockRef.current) : update;
    dockRef.current = next;
    setDock(next);
    return next;
  }, []);

  const enqueueTransition = useCallback((operation) => {
    const result = transitionTailRef.current.then(operation, operation);
    transitionTailRef.current = result.catch(() => {});
    return result;
  }, []);

  const enterDockMode = useCallback(
    (edge, reserveSpaceOverride) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        const current = dockRef.current;
        const hasReserveOverride = typeof reserveSpaceOverride === "boolean";
        await enterDock(edge, hasReserveOverride ? reserveSpaceOverride : undefined);
        const changed =
          !current.enabled ||
          current.edge !== edge ||
          (hasReserveOverride && current.reserveSpace !== reserveSpaceOverride);
        commitDock((latest) => ({
          ...latest,
          enabled: true,
          edge,
          reserveSpace: hasReserveOverride ? reserveSpaceOverride : latest.reserveSpace,
        }));
        if (changed) presetsStore.patch({ dirty: true });
      });
    },
    [commitDock, enqueueTransition]
  );

  const exitDockMode = useCallback(
    ({ decorations, alwaysOnTop }) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        const wasEnabled = dockRef.current.enabled;
        await exitDock({ decorations, alwaysOnTop });
        commitDock((latest) => ({ ...latest, enabled: false }));
        if (wasEnabled) presetsStore.patch({ dirty: true });
      });
    },
    [commitDock, enqueueTransition]
  );

  const applyReserveSpace = useCallback(
    async (enabled, edgeOverride) => {
      const current = dockRef.current;
      const edge =
        edgeOverride === "top" || edgeOverride === "bottom" ? edgeOverride : current.edge;
      await setDockReserveSpace({ enabled, edge });
      commitDock((latest) => ({ ...latest, edge, reserveSpace: enabled }));
      if (current.reserveSpace !== enabled || current.edge !== edge) {
        presetsStore.patch({ dirty: true });
      }
    },
    [commitDock]
  );

  const setReserveSpace = useCallback(
    (enabled, edgeOverride) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(() => applyReserveSpace(enabled, edgeOverride));
    },
    [applyReserveSpace, enqueueTransition]
  );

  const toggleReserveSpace = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return enqueueTransition(() => applyReserveSpace(!dockRef.current.reserveSpace));
  }, [applyReserveSpace, enqueueTransition]);

  return {
    dockEnabled: dock.enabled,
    dockEdge: dock.edge,
    reserveSpace: dock.reserveSpace,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
  };
}
