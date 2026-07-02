import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { bindWorkspaceActions, normalizePinnedPanelsById, workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { normalizePanelControlsById } from "./panelControlInstances.js";
import { hasKnownModulesOnly } from "./panelInstances.js";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { normalizeReferenceLufs } from "../settings/defaults.js";

const WorkspaceContext = createContext(null);

function normalizeWorkspacePanelControls(panelsById, panelControlsById, referenceFallback) {
  const normalized = normalizePanelControlsById(panelsById, panelControlsById);
  const fallback = normalizeReferenceLufs(referenceFallback);
  for (const [id, panel] of Object.entries(panelsById ?? {})) {
    if (panel?.moduleId !== "loudness") continue;
    if (panelControlsById?.[id]?.loudnessReferenceLufs != null) continue;
    normalized[id] = {
      ...normalized[id],
      loudnessReferenceLufs: fallback,
    };
  }
  return normalized;
}

function initState() {
  const parsed = workspaceStore.read();
  const legacyReferenceLufs = normalizeReferenceLufs(settingsStore.read().referenceLufs);
  if (!parsed.tree || !parsed.panelsById || !Array.isArray(parsed.panelOrder)) {
    return {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: normalizeWorkspacePanelControls(
        DEFAULT_WORKSPACE_STATE.panelsById,
        DEFAULT_WORKSPACE_STATE.panelControlsById,
        legacyReferenceLufs
      ),
    };
  }
  if (!hasKnownModulesOnly(parsed)) {
    return {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: normalizeWorkspacePanelControls(
        DEFAULT_WORKSPACE_STATE.panelsById,
        DEFAULT_WORKSPACE_STATE.panelControlsById,
        legacyReferenceLufs
      ),
    };
  }
  return {
    ...DEFAULT_WORKSPACE_STATE,
    ...parsed,
    panelControlsById: normalizeWorkspacePanelControls(
      parsed.panelsById,
      parsed.panelControlsById,
      legacyReferenceLufs
    ),
    pinnedPanelsById: normalizePinnedPanelsById(parsed.panelsById, parsed.pinnedPanelsById),
    fullscreenId: null, // transient view state: never restored across launches
  };
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, null, initState);
  const [hoveredPanelId, setHoveredPanelId] = useState(null);
  const actions = useMemo(() => {
    const bound = bindWorkspaceActions(dispatch);
    const clearActivePreset = () => presetsStore.patch({ activeId: null });
    return {
      ...bound,
      setTree: (...args) => {
        clearActivePreset();
        bound.setTree(...args);
      },
      moveTab: (...args) => {
        clearActivePreset();
        bound.moveTab(...args);
      },
      resizeChildren: (...args) => {
        clearActivePreset();
        bound.resizeChildren(...args);
      },
      addPanel: (...args) => {
        clearActivePreset();
        bound.addPanel(...args);
      },
      removePanel: (...args) => {
        clearActivePreset();
        bound.removePanel(...args);
      },
      renamePanel: (...args) => {
        clearActivePreset();
        bound.renamePanel(...args);
      },
      setPanelPinned: (...args) => {
        clearActivePreset();
        bound.setPanelPinned(...args);
      },
      setPanelControlsForPanel: (...args) => {
        clearActivePreset();
        bound.setPanelControlsForPanel(...args);
      },
      resetWorkspace: (...args) => {
        clearActivePreset();
        bound.resetWorkspace(...args);
      },
    };
  }, []);

  useEffect(() => {
    workspaceStore.patch(state);
  }, [state]);

  const value = useMemo(
    () => ({ state, hoveredPanelId, setHoveredPanelId, ...actions }),
    [state, hoveredPanelId, actions]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** @returns {{ state: import('./types.js').WorkspaceState } & ReturnType<import('./reducer.js').bindWorkspaceActions>} */
export function useWorkspaceStore() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceStore must be used inside WorkspaceProvider");
  return ctx;
}
