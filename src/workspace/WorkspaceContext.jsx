import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { bindWorkspaceActions, normalizePinnedPanelsById, workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { normalizePanelControlsById } from "./panelControlInstances.js";
import { normalizeAxisViewportsState } from "./axisViewports.js";
import { hasKnownModulesOnly } from "./panelInstances.js";
import { presetsStore, workspaceStore } from "../persistence/index.js";

const WorkspaceContext = createContext(null);

function ownedWorkspaceState(state) {
  return {
    tree: state.tree,
    panelsById: state.panelsById,
    panelOrder: state.panelOrder,
    fullscreenId: state.fullscreenId,
    panelControlsById: state.panelControlsById,
    pinnedPanelsById: state.pinnedPanelsById,
    axisViewports: state.axisViewports,
  };
}

function initState() {
  const parsed = workspaceStore.read();
  if (!parsed.tree || !parsed.panelsById || !Array.isArray(parsed.panelOrder)) {
    return {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: normalizePanelControlsById(
        DEFAULT_WORKSPACE_STATE.panelsById,
        DEFAULT_WORKSPACE_STATE.panelControlsById
      ),
    };
  }
  if (!hasKnownModulesOnly(parsed)) {
    return {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: normalizePanelControlsById(
        DEFAULT_WORKSPACE_STATE.panelsById,
        DEFAULT_WORKSPACE_STATE.panelControlsById
      ),
    };
  }
  return {
    ...DEFAULT_WORKSPACE_STATE,
    tree: parsed.tree,
    panelsById: parsed.panelsById,
    panelOrder: parsed.panelOrder,
    panelControlsById: normalizePanelControlsById(parsed.panelsById, parsed.panelControlsById),
    pinnedPanelsById: normalizePinnedPanelsById(parsed.panelsById, parsed.pinnedPanelsById),
    axisViewports: normalizeAxisViewportsState(parsed.axisViewports),
    fullscreenId: null, // transient view state: never restored across launches
  };
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, null, initState);
  const [hoveredPanelId, setHoveredPanelId] = useState(null);
  const persistedWorkspaceRef = useRef(null);
  const persistenceWaitersRef = useRef(new Set());
  const actions = useMemo(() => {
    const bound = bindWorkspaceActions(dispatch);
    // Fires on every gesture, including each pointer move of a slider drag, so an unguarded
    // patch serialised the whole presets domain a hundred times a second to re-assert a flag
    // that was already set. The transition is what matters; the read is the cheap half.
    const markPresetDirty = () => {
      if (presetsStore.read().dirty === true) return;
      presetsStore.patch({ dirty: true });
    };
    return {
      ...bound,
      // Whole-workspace callers (imports, live control, and future restore flows) get one semantic
      // action instead of access to the reducer dispatcher. Preset application intentionally keeps
      // using the neutral setView action because it restores its own active/dirty metadata.
      replaceWorkspace: (view) => {
        markPresetDirty();
        bound.setView(view);
      },
      setTree: (...args) => {
        markPresetDirty();
        bound.setTree(...args);
      },
      moveTab: (...args) => {
        markPresetDirty();
        bound.moveTab(...args);
      },
      resizeChildren: (...args) => {
        markPresetDirty();
        bound.resizeChildren(...args);
      },
      addPanel: (...args) => {
        markPresetDirty();
        bound.addPanel(...args);
      },
      addPanelAt: (...args) => {
        markPresetDirty();
        bound.addPanelAt(...args);
      },
      removePanel: (...args) => {
        markPresetDirty();
        bound.removePanel(...args);
      },
      renamePanel: (...args) => {
        markPresetDirty();
        bound.renamePanel(...args);
      },
      setPanelPinned: (...args) => {
        markPresetDirty();
        bound.setPanelPinned(...args);
      },
      setPanelControlsForPanel: (...args) => {
        markPresetDirty();
        bound.setPanelControlsForPanel(...args);
      },
      resetPanelControlsForPanel: (...args) => {
        markPresetDirty();
        bound.resetPanelControlsForPanel(...args);
      },
      setAxisViewport: (...args) => {
        markPresetDirty();
        bound.setAxisViewport(...args);
      },
      joinAxisViewport: (...args) => {
        markPresetDirty();
        bound.joinAxisViewport(...args);
      },
      leaveAxisViewport: (...args) => {
        markPresetDirty();
        bound.leaveAxisViewport(...args);
      },
      resetWorkspace: (...args) => {
        markPresetDirty();
        bound.resetWorkspace(...args);
      },
    };
  }, []);

  // Every control gesture lands here -- a slider drag fires one state change per pointer move,
  // and this domain carries the whole layout tree plus every panel's controls, so a synchronous
  // patch made each move pay a full get + parse + merge + stringify + set on the main thread.
  useEffect(() => {
    workspaceStore.patchCoalesced(ownedWorkspaceState(state));
    persistedWorkspaceRef.current = state;
    for (const waiter of persistenceWaitersRef.current) {
      if (
        state.tree === waiter.view.tree &&
        state.panelsById === waiter.view.panelsById &&
        state.panelOrder === waiter.view.panelOrder
      ) {
        persistenceWaitersRef.current.delete(waiter);
        waiter.resolve();
      }
    }
  }, [state]);

  const waitForWorkspacePersistenceEnqueue = useCallback((view) => {
    const persisted = persistedWorkspaceRef.current;
    if (
      persisted?.tree === view.tree &&
      persisted?.panelsById === view.panelsById &&
      persisted?.panelOrder === view.panelOrder
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      persistenceWaitersRef.current.add({ view, resolve });
    });
  }, []);

  const value = useMemo(
    () => ({
      state,
      hoveredPanelId,
      setHoveredPanelId,
      waitForWorkspacePersistenceEnqueue,
      ...actions,
    }),
    [state, hoveredPanelId, waitForWorkspacePersistenceEnqueue, actions]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** @returns {{ state: import('./types.js').WorkspaceState } & ReturnType<import('./reducer.js').bindWorkspaceActions>} */
export function useWorkspaceStore() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceStore must be used inside WorkspaceProvider");
  return ctx;
}
