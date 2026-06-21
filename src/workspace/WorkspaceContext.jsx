import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { bindWorkspaceActions, workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { normalizePanelControlsById } from "./panelControlInstances.js";
import { presetsStore, workspaceStore } from "../persistence/index.js";

const WorkspaceContext = createContext(null);

function initState() {
  const parsed = workspaceStore.read();
  if (!parsed.tree || !parsed.panelsById || !Array.isArray(parsed.panelOrder)) {
    return DEFAULT_WORKSPACE_STATE;
  }
  return {
    ...DEFAULT_WORKSPACE_STATE,
    ...parsed,
    panelControlsById: normalizePanelControlsById(parsed.panelsById, parsed.panelControlsById),
    fullscreenId: null, // transient view state: never restored across launches
  };
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, null, initState);
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

  const value = useMemo(() => ({ state, ...actions }), [state, actions]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** @returns {{ state: import('./types.js').WorkspaceState } & ReturnType<import('./reducer.js').bindWorkspaceActions>} */
export function useWorkspaceStore() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceStore must be used inside WorkspaceProvider");
  return ctx;
}
