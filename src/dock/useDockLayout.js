import { useCallback, useMemo, useState } from "react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import {
  addDockPanel,
  dockModuleIdForPanelModuleId,
  normalizeDockLayout,
  normalizeDockStatsIds,
  removeDockPanel,
  renameDockPanel,
  reorderDockModule,
  setDockPanelOrder,
  toggleDockModule,
  toggleDockStatId,
} from "./dockLayout.js";
import {
  controlsByModuleIdFromPanels,
  dockControlModuleIdForPanel,
  normalizeDockControlsByModuleId,
  normalizeDockControlsByPanelId,
  updateDockPanelControls,
} from "./dockModuleControls.js";

function readDockState() {
  const raw = workspaceStore.read().dock;
  const layout = normalizeDockLayout(raw);
  return {
    layout,
    controlsByPanelId: normalizeDockControlsByPanelId(layout.panelsById, raw?.controlsByPanelId),
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
        panelsById: next.layout.panelsById,
        panelOrder: next.layout.panelOrder,
        controlsByPanelId: next.controlsByPanelId,
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
      const layout = normalizeDockLayout({ modules });
      write({
        layout,
        controlsByPanelId: normalizeDockControlsByPanelId(
          layout.panelsById,
          undefined,
          controlsByModuleIdFromPanels(
            current.layout.panelsById,
            current.layout.panelOrder,
            current.controlsByPanelId
          )
        ),
      });
    },
    [write]
  );
  const setPanels = useCallback(
    (dockLike) => {
      const layout = normalizeDockLayout(dockLike);
      write({
        layout,
        controlsByPanelId: normalizeDockControlsByPanelId(
          layout.panelsById,
          dockLike?.controlsByPanelId
        ),
      });
    },
    [write]
  );
  const addPanel = useCallback(
    (moduleId) => {
      const current = readDockState();
      const layout = addDockPanel(current.layout, moduleId);
      write({
        layout,
        controlsByPanelId: normalizeDockControlsByPanelId(
          layout.panelsById,
          current.controlsByPanelId
        ),
      });
    },
    [write]
  );
  const removePanel = useCallback(
    (panelId) => {
      const current = readDockState();
      const layout = removeDockPanel(current.layout, panelId);
      const { [panelId]: _removed, ...controlsByPanelId } = current.controlsByPanelId;
      write({ layout, controlsByPanelId });
    },
    [write]
  );
  const renamePanel = useCallback(
    (panelId, customTitle) => {
      const current = readDockState();
      write({
        ...current,
        layout: renameDockPanel(current.layout, panelId, customTitle),
      });
    },
    [write]
  );
  const setPanelOrder = useCallback(
    (panelOrder) => {
      const current = readDockState();
      write({ ...current, layout: setDockPanelOrder(current.layout, panelOrder) });
    },
    [write]
  );
  const toggleStat = useCallback(
    (id) => {
      const current = readDockState();
      const statsPanelId = current.layout.panelOrder.find(
        (panelId) => current.layout.panelsById[panelId]?.moduleId === "stats"
      );
      if (!statsPanelId) return;
      write({
        ...current,
        controlsByPanelId: updateDockPanelControls(
          current.controlsByPanelId,
          current.layout.panelsById,
          statsPanelId,
          { ids: toggleDockStatId(current.controlsByPanelId[statsPanelId]?.ids ?? [], id) }
        ),
      });
    },
    [write]
  );
  const setStatsIds = useCallback(
    (ids) => {
      const current = readDockState();
      const statsPanelId = current.layout.panelOrder.find(
        (panelId) => current.layout.panelsById[panelId]?.moduleId === "stats"
      );
      if (!statsPanelId) return;
      write({
        ...current,
        controlsByPanelId: updateDockPanelControls(
          current.controlsByPanelId,
          current.layout.panelsById,
          statsPanelId,
          { ids: normalizeDockStatsIds(ids) }
        ),
      });
    },
    [write]
  );

  const setPanelControls = useCallback(
    (panelId, controls) => {
      const current = readDockState();
      write({
        ...current,
        controlsByPanelId: updateDockPanelControls(
          current.controlsByPanelId,
          current.layout.panelsById,
          panelId,
          controls
        ),
      });
    },
    [write]
  );

  const setModuleControls = useCallback(
    (moduleId, controls) => {
      const current = readDockState();
      const panelId = current.layout.panelOrder.find((id) => {
        const panel = current.layout.panelsById[id];
        return (
          panel?.moduleId === moduleId || dockModuleIdForPanelModuleId(panel?.moduleId) === moduleId
        );
      });
      if (!panelId) return;
      setPanelControls(panelId, controls);
    },
    [setPanelControls]
  );

  const resetPanelControls = useCallback(
    (panelId) => {
      const current = readDockState();
      const controlModuleId = dockControlModuleIdForPanel(current.layout.panelsById[panelId]);
      const defaults = normalizeDockControlsByModuleId()[controlModuleId];
      if (!defaults) return;
      setPanelControls(panelId, defaults);
    },
    [setPanelControls]
  );

  const resetModuleControls = useCallback(
    (moduleId) => {
      const current = readDockState();
      const panelId = current.layout.panelOrder.find((id) => {
        const panel = current.layout.panelsById[id];
        return (
          panel?.moduleId === moduleId || dockModuleIdForPanelModuleId(panel?.moduleId) === moduleId
        );
      });
      if (!panelId) return;
      resetPanelControls(panelId);
    },
    [resetPanelControls]
  );
  const panels = useMemo(
    () =>
      state.layout.panelOrder.map((panelId) => state.layout.panelsById[panelId]).filter(Boolean),
    [state.layout.panelOrder, state.layout.panelsById]
  );
  const controlsByModuleId = useMemo(
    () =>
      controlsByModuleIdFromPanels(
        state.layout.panelsById,
        state.layout.panelOrder,
        state.controlsByPanelId
      ),
    [state.controlsByPanelId, state.layout.panelOrder, state.layout.panelsById]
  );
  const modules = useMemo(
    () =>
      state.layout.panelOrder
        .map((panelId) => dockModuleIdForPanelModuleId(state.layout.panelsById[panelId]?.moduleId))
        .filter(Boolean),
    [state.layout.panelOrder, state.layout.panelsById]
  );

  return {
    panelsById: state.layout.panelsById,
    panelOrder: state.layout.panelOrder,
    panels,
    controlsByPanelId: state.controlsByPanelId,
    modules,
    controlsByModuleId,
    statsIds: controlsByModuleId.stats.ids,
    toggle,
    reorder,
    setModules,
    setPanels,
    addPanel,
    removePanel,
    renamePanel,
    setPanelOrder,
    toggleStat,
    setStatsIds,
    setPanelControls,
    resetPanelControls,
    setModuleControls,
    resetModuleControls,
  };
}
