/** @import { WorkspaceState, DropTarget, TreeNode } from './types.js' */
import {
  createDefaultPanelControls,
  normalizePanelControlsById,
  updatePanelControlsById,
} from "./panelControlInstances.js";
import { createPanel, trimCustomTitle } from "./panelInstances.js";
import { findLeafWithTab, insertLeaf, removeTab, updateNode } from "./treeUtils.js";

// ---------------------------------------------------------------------------
// MOVE_TAB helpers
// ---------------------------------------------------------------------------

/**
 * After removeTab changes the tree, the original targetPath from the drop
 * event may be stale. We re-anchor by finding a known tab in the target leaf.
 *
 * @param {TreeNode} tree  Tree after removeTab
 * @param {string} anchorTab  A tab we know was in the target leaf
 * @param {number[]} fallbackPath  Original path (used if anchor not found)
 * @returns {number[]}
 */
function resolveTargetPath(tree, anchorTab, fallbackPath) {
  if (!anchorTab) return fallbackPath;
  const found = findLeafWithTab(tree, anchorTab);
  return found ?? fallbackPath;
}

function isPathValid(root, path) {
  let node = root;
  for (const idx of path) {
    if (!node?.children) return false;
    node = node.children[idx];
  }
  return node != null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * @param {WorkspaceState} state
 * @param {{ type: string, payload?: any }} action
 * @returns {WorkspaceState}
 */
export function workspaceReducer(state, action) {
  switch (action.type) {
    case "SET_TREE":
      return { ...state, tree: action.payload.tree };

    case "RESIZE_CHILDREN": {
      if (!state.tree) return state;
      const { path, aboveIdx, belowIdx, aboveSize, belowSize } = action.payload;
      const actualBelowIdx = belowIdx ?? aboveIdx + 1;
      const newTree = updateNode(state.tree, path, (node) => {
        const sizes = [...node.sizes];
        sizes[aboveIdx] = aboveSize;
        sizes[actualBelowIdx] = belowSize;
        return { ...node, sizes };
      });
      return { ...state, tree: newTree };
    }

    case "SET_ACTIVE_TAB": {
      if (!state.tree) return state;
      const { path, tabId } = action.payload;
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: tabId }));
      return { ...state, tree: newTree };
    }

    case "ADD_PANEL": {
      const { moduleId } = action.payload;
      const panel = createPanel(moduleId, state.panelsById);
      const newLeaf = { type: "leaf", tabs: [panel.id], activeTab: panel.id };
      return {
        ...state,
        tree: state.tree ? insertLeaf(state.tree, [], "right", newLeaf) : newLeaf,
        panelsById: { ...state.panelsById, [panel.id]: panel },
        panelOrder: [...state.panelOrder, panel.id],
        panelControlsById: {
          ...state.panelControlsById,
          [panel.id]: createDefaultPanelControls(),
        },
      };
    }

    case "REMOVE_PANEL": {
      const { id } = action.payload;
      if (!state.panelsById[id]) return state;
      const { [id]: _removed, ...panelsById } = state.panelsById;
      const { [id]: _removedControls, ...panelControlsById } = state.panelControlsById ?? {};
      return {
        ...state,
        tree: state.tree ? removeTab(state.tree, id) : null,
        panelsById,
        panelOrder: state.panelOrder.filter((panelId) => panelId !== id),
        panelControlsById,
        fullscreenId: state.fullscreenId === id ? null : state.fullscreenId,
      };
    }

    case "RENAME_PANEL": {
      const { id, customTitle } = action.payload;
      const panel = state.panelsById[id];
      if (!panel) return state;
      const title = trimCustomTitle(customTitle);
      const nextPanel = { ...panel };
      if (title) nextPanel.customTitle = title;
      else delete nextPanel.customTitle;
      return {
        ...state,
        panelsById: { ...state.panelsById, [id]: nextPanel },
      };
    }

    case "SET_FOCUS": {
      if (!state.tree) return state;
      const { id } = action.payload;
      const path = findLeafWithTab(state.tree, id);
      if (!path) return state;
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: id }));
      return { ...state, tree: newTree };
    }

    case "SET_FULLSCREEN":
      return { ...state, fullscreenId: action.payload };

    case "MOVE_TAB": {
      if (!state.tree) return state;
      const { sourceId, drop } = action.payload;
      const { targetPath, zone, tabIndex = 0 } = drop;

      const targetLeaf = (() => {
        try {
          let node = state.tree;
          for (const idx of targetPath) node = node.children[idx];
          return node.type === "leaf" ? node : null;
        } catch (_) {
          return null;
        }
      })();
      const anchorTab = targetLeaf?.tabs.find((t) => t !== sourceId) ?? null;

      const treeAfterRemove = removeTab(state.tree, sourceId);
      if (!treeAfterRemove) return state;

      const resolvedPath = resolveTargetPath(treeAfterRemove, anchorTab, targetPath);
      const safeTargetPath = isPathValid(treeAfterRemove, resolvedPath) ? resolvedPath : [];

      const newLeaf = { type: "leaf", tabs: [sourceId], activeTab: sourceId };
      const newTree = insertLeaf(treeAfterRemove, safeTargetPath, zone, newLeaf, tabIndex);

      return { ...state, tree: newTree };
    }

    case "SET_VIEW": {
      const { tree, panelsById, panelOrder, panelControlsById } = action.payload;
      return {
        ...state,
        tree,
        panelsById,
        panelOrder,
        panelControlsById: normalizePanelControlsById(panelsById, panelControlsById),
        fullscreenId: null,
      };
    }

    case "SET_PANEL_CONTROLS_FOR_PANEL":
      return {
        ...state,
        panelControlsById: updatePanelControlsById(
          state.panelControlsById,
          action.payload.id,
          action.payload.panelControls
        ),
      };

    case "SET_PANEL_CONTROLS": {
      const id = state.panelOrder.find((panelId) => state.panelsById[panelId]);
      if (!id) return state;
      return {
        ...state,
        panelControlsById: updatePanelControlsById(
          state.panelControlsById,
          id,
          action.payload.panelControls
        ),
      };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Bound action creators
// ---------------------------------------------------------------------------

/** @param {React.Dispatch} dispatch */
export function bindWorkspaceActions(dispatch) {
  return {
    setTree: (tree) => dispatch({ type: "SET_TREE", payload: { tree } }),
    moveTab: (sourceId, drop) => dispatch({ type: "MOVE_TAB", payload: { sourceId, drop } }),
    setActiveTab: (path, tabId) => dispatch({ type: "SET_ACTIVE_TAB", payload: { path, tabId } }),
    addPanel: (moduleId) => dispatch({ type: "ADD_PANEL", payload: { moduleId } }),
    removePanel: (id) => dispatch({ type: "REMOVE_PANEL", payload: { id } }),
    renamePanel: (id, customTitle) =>
      dispatch({ type: "RENAME_PANEL", payload: { id, customTitle } }),
    setFocus: (id) => dispatch({ type: "SET_FOCUS", payload: { id } }),
    setFullscreen: (id) => dispatch({ type: "SET_FULLSCREEN", payload: id }),
    resizeChildren: (path, aboveIdx, belowIdx, aboveSize, belowSize) =>
      dispatch({
        type: "RESIZE_CHILDREN",
        payload: { path, aboveIdx, belowIdx, aboveSize, belowSize },
      }),
    setView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
    setPanelControlsForPanel: (id, panelControls) =>
      dispatch({ type: "SET_PANEL_CONTROLS_FOR_PANEL", payload: { id, panelControls } }),
    setPanelControls: (panelControls) =>
      dispatch({ type: "SET_PANEL_CONTROLS", payload: { panelControls } }),
  };
}
