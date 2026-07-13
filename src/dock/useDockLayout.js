import { useCallback, useState } from "react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import {
  normalizeDockLayout,
  normalizeDockStatsIds,
  reorderDockModule,
  toggleDockModule,
  toggleDockStatId,
} from "./dockLayout.js";
import { normalizeDockControlsByModuleId, updateDockModuleControls } from "./dockModuleControls.js";

function readDockState() {
  const raw = workspaceStore.read().dock;
  return {
    layout: normalizeDockLayout(raw),
    controlsByModuleId: normalizeDockControlsByModuleId(raw?.controlsByModuleId, raw?.statsIds),
  };
}

/**
 * Assumes a single mounted instance (App.jsx); local state is not synced via
 * workspaceStore.subscribe, so two simultaneous mounts would diverge.
 */
export function useDockLayout() {
  const [state, setState] = useState(readDockState);

  const write = useCallback((next) => {
    workspaceStore.patch({
      dock: {
        modules: next.layout.modules,
        controlsByModuleId: next.controlsByModuleId,
      },
    });
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
      write({
        ...current,
        controlsByModuleId: updateDockModuleControls(current.controlsByModuleId, "stats", {
          ids: toggleDockStatId(current.controlsByModuleId.stats.ids, id),
        }),
      });
    },
    [write]
  );
  const setStatsIds = useCallback(
    (ids) => {
      const current = readDockState();
      write({
        ...current,
        controlsByModuleId: updateDockModuleControls(current.controlsByModuleId, "stats", {
          ids: normalizeDockStatsIds(ids),
        }),
      });
    },
    [write]
  );

  const setModuleControls = useCallback(
    (moduleId, controls) => {
      const current = readDockState();
      write({
        ...current,
        controlsByModuleId: updateDockModuleControls(
          current.controlsByModuleId,
          moduleId,
          controls
        ),
      });
    },
    [write]
  );

  const resetModuleControls = useCallback(
    (moduleId) => {
      const defaults = normalizeDockControlsByModuleId()[moduleId];
      if (!defaults) return;
      setModuleControls(moduleId, defaults);
    },
    [setModuleControls]
  );
  const setControlsByModuleId = useCallback(
    (controlsByModuleId, legacyStatsIds) => {
      const current = readDockState();
      write({
        ...current,
        controlsByModuleId: normalizeDockControlsByModuleId(controlsByModuleId, legacyStatsIds),
      });
    },
    [write]
  );

  return {
    modules: state.layout.modules,
    controlsByModuleId: state.controlsByModuleId,
    statsIds: state.controlsByModuleId.stats.ids,
    toggle,
    reorder,
    setModules,
    toggleStat,
    setStatsIds,
    setModuleControls,
    resetModuleControls,
    setControlsByModuleId,
  };
}
