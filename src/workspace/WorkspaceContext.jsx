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
import { workspaceStore } from "../persistence/index.js";

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

function persistedWorkspaceMatches(left, right) {
  // Identity first, value as the fallback. Most callers wait on the very object they installed, so
  // the reference check settles it for free. Preset application cannot: the Workspace is built
  // inside `applySnapshot` while the waiter builds its own equal copy, and requiring identity for
  // tree/panelsById/panelOrder meant that waiter could never be satisfied.
  const sameValue = (leftValue, rightValue) =>
    leftValue === rightValue || JSON.stringify(leftValue) === JSON.stringify(rightValue);
  return (
    sameValue(left?.tree, right?.tree) &&
    sameValue(left?.panelsById, right?.panelsById) &&
    sameValue(left?.panelOrder, right?.panelOrder) &&
    sameValue(left?.panelControlsById, right?.panelControlsById) &&
    sameValue(left?.pinnedPanelsById, right?.pinnedPanelsById) &&
    sameValue(left?.axisViewports, right?.axisViewports) &&
    left?.fullscreenId === right?.fullscreenId
  );
}

function initState() {
  const parsed = workspaceStore.read();
  const hasPanels =
    parsed.panelsById &&
    typeof parsed.panelsById === "object" &&
    !Array.isArray(parsed.panelsById) &&
    Array.isArray(parsed.panelOrder);
  const empty =
    hasPanels &&
    parsed.tree === null &&
    parsed.panelOrder.length === 0 &&
    Object.keys(parsed.panelsById).length === 0;
  if (!hasPanels || (!parsed.tree && !empty) || !hasKnownModulesOnly(parsed)) {
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
    return {
      ...bound,
      // Whole-workspace callers (imports, live control, and future restore flows) get one semantic
      // action instead of access to the reducer dispatcher.
      replaceWorkspace: (view) => bound.setView(view),
      joinAxisViewport: (/** @type {any} */ ...args) => {
        dispatch({
          type: "JOIN_AXIS_VIEWPORT",
          payload: { kindId: args[0], panelId: args[1], dock: workspaceStore.read().dock },
        });
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
      if (waiter.matches(state)) waiter.finish();
    }
  }, [state]);

  const waitForWorkspacePersistenceEnqueue = useCallback(
    /**
     * @param {import("./types.js").WorkspaceState} view
     * @param {{ matches?: (state: import("./types.js").WorkspaceState) => boolean, signal?: AbortSignal }} [options]
     */
    (view, { matches = (state) => persistedWorkspaceMatches(state, view), signal } = {}) => {
      const persisted = persistedWorkspaceRef.current;
      if (persisted && matches(persisted)) return Promise.resolve();
      const waiters = persistenceWaitersRef.current;
      return new Promise((resolve, reject) => {
        const waiter = {
          matches,
          finish(error) {
            waiters.delete(waiter);
            signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve(undefined);
          },
        };
        const abort = () => waiter.finish(signal.reason);
        if (signal?.aborted) {
          abort();
          return;
        }
        waiters.add(waiter);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    []
  );

  useEffect(() => {
    const waiters = persistenceWaitersRef.current;
    return () => {
      for (const waiter of waiters) waiter.finish(new Error("Workspace closed before saving."));
    };
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

/**
 * In-memory provider for trusted render fixtures. It deliberately exposes the same business
 * actions as the real Workspace while omitting every persistence read and write.
 */
export function WorkspacePreviewProvider({ state: initialState, children }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const [hoveredPanelId, setHoveredPanelId] = useState(null);
  const actions = useMemo(() => bindWorkspaceActions(dispatch), []);
  const value = useMemo(
    () => ({
      state,
      hoveredPanelId,
      setHoveredPanelId,
      waitForWorkspacePersistenceEnqueue: () => Promise.resolve(),
      replaceWorkspace: actions.setView,
      ...actions,
    }),
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
