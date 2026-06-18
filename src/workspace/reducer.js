/** @import { WorkspaceState, ModuleId, DropTarget, TreeNode } from './types.js' */
import { normalizePanelControls } from "../lib/panelControls.js";
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
      const { path, tabId } = action.payload;
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: tabId }));
      return { ...state, tree: newTree };
    }

    case "TOGGLE_MODULE_VISIBLE": {
      const { id } = action.payload;
      const isVisible = state.visibleModules.includes(id);
      const visibleModules = isVisible
        ? state.visibleModules.filter((m) => m !== id)
        : [...state.visibleModules, id];
      // Tree structure is unchanged — visibleModules controls rendering only
      return { ...state, visibleModules };
    }

    case "SET_FOCUS": {
      const { id } = action.payload;
      const path = findLeafWithTab(state.tree, id);
      if (!path) return state;
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: id }));
      return { ...state, tree: newTree };
    }

    case "SET_FULLSCREEN":
      return { ...state, fullscreenId: action.payload };

    case "MOVE_TAB": {
      const { sourceId, drop } = action.payload;
      const { targetPath, zone, tabIndex = 0 } = drop;

      // Identify an anchor tab in the target leaf so we can re-find it after removal
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

      // Remove source tab (may change tree structure)
      const treeAfterRemove = removeTab(state.tree, sourceId);
      if (!treeAfterRemove) return state;

      // Re-resolve target path using anchor; fall back to root if path is now stale
      const resolvedPath = resolveTargetPath(treeAfterRemove, anchorTab, targetPath);
      const safeTargetPath = isPathValid(treeAfterRemove, resolvedPath) ? resolvedPath : [];

      // Insert new leaf at resolved target
      const newLeaf = { type: "leaf", tabs: [sourceId], activeTab: sourceId };
      const newTree = insertLeaf(treeAfterRemove, safeTargetPath, zone, newLeaf, tabIndex);

      return { ...state, tree: newTree };
    }

    case "SET_VIEW": {
      const { tree, visibleModules, panelControls } = action.payload;
      return {
        ...state,
        tree,
        visibleModules,
        panelControls: normalizePanelControls(panelControls),
        fullscreenId: null,
      };
    }

    case "SET_PANEL_CONTROLS":
      return {
        ...state,
        panelControls: normalizePanelControls(action.payload.panelControls),
      };

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
    toggleModuleVisible: (id) => dispatch({ type: "TOGGLE_MODULE_VISIBLE", payload: { id } }),
    setFocus: (id) => dispatch({ type: "SET_FOCUS", payload: { id } }),
    setFullscreen: (id) => dispatch({ type: "SET_FULLSCREEN", payload: id }),
    resizeChildren: (path, aboveIdx, belowIdx, aboveSize, belowSize) =>
      dispatch({
        type: "RESIZE_CHILDREN",
        payload: { path, aboveIdx, belowIdx, aboveSize, belowSize },
      }),
    setView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
    setPanelControls: (panelControls) =>
      dispatch({ type: "SET_PANEL_CONTROLS", payload: { panelControls } }),
  };
}
