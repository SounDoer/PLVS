import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { bindWorkspaceActions, workspaceReducer } from './reducer.js';
import { DEFAULT_WORKSPACE_STATE, WORKSPACE_STORAGE_KEY } from './constants.js';

const WorkspaceContext = createContext(null);

function initState() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed.dock || !Array.isArray(parsed.visibleModules)) return DEFAULT_WORKSPACE_STATE;
    // Merge missing top-level fields (forward-compat)
    return {
      ...DEFAULT_WORKSPACE_STATE,
      ...parsed,
      customPresets: Array.isArray(parsed.customPresets) ? parsed.customPresets : [],
    };
  } catch (_) {
    return DEFAULT_WORKSPACE_STATE;
  }
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, null, initState);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }, [state]);

  const value = useMemo(
    () => ({ state, ...bindWorkspaceActions(dispatch) }),
    [state]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** @returns {{ state: import('./types.js').WorkspaceState } & ReturnType<import('./reducer.js').bindWorkspaceActions>} */
export function useWorkspaceStore() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceStore must be used inside WorkspaceProvider');
  return ctx;
}
