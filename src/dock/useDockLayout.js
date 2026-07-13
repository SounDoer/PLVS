import { useCallback, useState } from "react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import {
  normalizeDockLayout,
  normalizeDockStatsIds,
  reorderDockModule,
  toggleDockModule,
  toggleDockStatId,
} from "./dockLayout.js";

function readDockState() {
  const raw = workspaceStore.read().dock;
  return {
    layout: normalizeDockLayout(raw),
    statsIds: normalizeDockStatsIds(raw?.statsIds),
  };
}

/**
 * Assumes a single mounted instance (App.jsx); local state is not synced via
 * workspaceStore.subscribe, so two simultaneous mounts would diverge.
 */
export function useDockLayout() {
  const [state, setState] = useState(readDockState);

  const write = useCallback((next) => {
    workspaceStore.patch({ dock: { modules: next.layout.modules, statsIds: next.statsIds } });
    // Dock layout is part of the preset snapshot, so edits dirty the active
    // preset (usePresets.apply clears the flag when it finishes).
    presetsStore.patch({ dirty: true });
    setState(next);
  }, []);

  const toggle = useCallback(
    (id) => {
      const current = readDockState();
      write({ ...current, layout: toggleDockModule(current.layout, id) });
    },
    [write]
  );
  const reorder = useCallback(
    (from, to) => {
      const current = readDockState();
      write({ ...current, layout: reorderDockModule(current.layout, from, to) });
    },
    [write]
  );
  const setModules = useCallback(
    (modules) => {
      const current = readDockState();
      write({ ...current, layout: normalizeDockLayout({ modules }) });
    },
    [write]
  );
  const toggleStat = useCallback(
    (id) => {
      const current = readDockState();
      write({ ...current, statsIds: toggleDockStatId(current.statsIds, id) });
    },
    [write]
  );
  const setStatsIds = useCallback(
    (ids) => {
      const current = readDockState();
      write({ ...current, statsIds: normalizeDockStatsIds(ids) });
    },
    [write]
  );

  return {
    modules: state.layout.modules,
    statsIds: state.statsIds,
    toggle,
    reorder,
    setModules,
    toggleStat,
    setStatsIds,
  };
}
