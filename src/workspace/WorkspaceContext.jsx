import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { bindWorkspaceActions, workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { presetsStore, workspaceStore } from "../persistence/index.js";

const WorkspaceContext = createContext(null);

function initState() {
  const parsed = workspaceStore.read();
  if (!parsed.tree || !Array.isArray(parsed.visibleModules)) return DEFAULT_WORKSPACE_STATE;
  return {
    ...DEFAULT_WORKSPACE_STATE,
    ...parsed,
    fullscreenId: null, // transient view state: never restored across launches
  };
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, null, initState);
  const [hoveredModuleId, setHoveredModuleId] = useState(null);
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
      toggleModuleVisible: (...args) => {
        clearActivePreset();
        bound.toggleModuleVisible(...args);
      },
      setPanelControls: (...args) => {
        clearActivePreset();
        bound.setPanelControls(...args);
      },
    };
  }, []);

  useEffect(() => {
    workspaceStore.patch(state);
  }, [state]);

  const value = useMemo(
    () => ({ state, ...actions, hoveredModuleId, setHoveredModuleId }),
    [state, actions, hoveredModuleId]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** @returns {{ state: import('./types.js').WorkspaceState } & ReturnType<import('./reducer.js').bindWorkspaceActions>} */
export function useWorkspaceStore() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceStore must be used inside WorkspaceProvider");
  return ctx;
}
