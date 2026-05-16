/** @import { WorkspaceState, ModuleId, DropTarget, TreeNode } from './types.js' */
import { BUILTIN_PRESETS } from "./constants.js";
import { findLeafWithTab, insertLeaf, removeTab, updateNode } from "./treeUtils.js";

// ---------------------------------------------------------------------------
// scaleTreeSizes — proportionally rescale non-zero sizes on window resize
// ---------------------------------------------------------------------------

function scaleTreeSizes(node, scaleX, scaleY) {
  if (node.type === "leaf") return node;
  const scale = node.direction === "h" ? scaleX : scaleY;
  const newSizes = node.sizes.map((s) => (s > 0 ? Math.max(80, Math.round(s * scale)) : 0));
  const newChildren = node.children.map((c) => scaleTreeSizes(c, scaleX, scaleY));
  if (
    newSizes.every((s, i) => s === node.sizes[i]) &&
    newChildren.every((c, i) => c === node.children[i])
  ) {
    return node;
  }
  return { ...node, sizes: newSizes, children: newChildren };
}

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
      return { ...state, tree: action.payload.tree, activePresetId: null };

    case "RESIZE_CHILDREN": {
      const { path, aboveIdx, aboveSize, belowSize } = action.payload;
      const newTree = updateNode(state.tree, path, (node) => {
        const sizes = [...node.sizes];
        sizes[aboveIdx] = aboveSize;
        sizes[aboveIdx + 1] = belowSize;
        return { ...node, sizes };
      });
      return { ...state, tree: newTree };
    }

    case "SCALE_TREE_SIZES": {
      const { scaleX, scaleY } = action.payload;
      const newTree = scaleTreeSizes(state.tree, scaleX, scaleY);
      return newTree === state.tree ? state : { ...state, tree: newTree };
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
      const focusId = isVisible && state.focusId === id ? null : state.focusId;
      // Tree structure is unchanged — visibleModules controls rendering only
      return { ...state, visibleModules, focusId };
    }

    case "SET_FOCUS": {
      const { id } = action.payload;
      const path = findLeafWithTab(state.tree, id);
      if (!path) return { ...state, focusId: id };
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: id }));
      return { ...state, tree: newTree, focusId: id };
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
      if (!treeAfterRemove) return { ...state, activePresetId: null };

      // Re-resolve target path using anchor; fall back to root if path is now stale
      const resolvedPath = resolveTargetPath(treeAfterRemove, anchorTab, targetPath);
      const safeTargetPath = isPathValid(treeAfterRemove, resolvedPath) ? resolvedPath : [];

      // Insert new leaf at resolved target
      const newLeaf = { type: "leaf", tabs: [sourceId], activeTab: sourceId };
      const newTree = insertLeaf(treeAfterRemove, safeTargetPath, zone, newLeaf, tabIndex);

      return { ...state, tree: newTree, activePresetId: null };
    }

    case "APPLY_PRESET": {
      const { presetId } = action.payload;
      const preset =
        BUILTIN_PRESETS.find((p) => p.id === presetId) ||
        state.customPresets.find((p) => p.id === presetId);
      if (!preset) return state;
      return {
        ...state,
        tree: preset.tree,
        visibleModules: preset.visibleModules,
        activePresetId: presetId,
        fullscreenId: null,
      };
    }

    case "SAVE_PRESET": {
      const { name } = action.payload;
      const id = `custom-${Date.now()}`;
      const newPreset = {
        id,
        name,
        builtin: false,
        tree: state.tree,
        visibleModules: state.visibleModules,
      };
      return {
        ...state,
        customPresets: [...state.customPresets, newPreset],
        activePresetId: id,
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
    toggleModuleVisible: (id) => dispatch({ type: "TOGGLE_MODULE_VISIBLE", payload: { id } }),
    setFocus: (id) => dispatch({ type: "SET_FOCUS", payload: { id } }),
    setFullscreen: (id) => dispatch({ type: "SET_FULLSCREEN", payload: id }),
    resizeChildren: (path, aboveIdx, aboveSize, belowSize) =>
      dispatch({ type: "RESIZE_CHILDREN", payload: { path, aboveIdx, aboveSize, belowSize } }),
    scaleSizes: (scaleX, scaleY) =>
      dispatch({ type: "SCALE_TREE_SIZES", payload: { scaleX, scaleY } }),
    applyPreset: (presetId) => dispatch({ type: "APPLY_PRESET", payload: { presetId } }),
    saveCurrentAsPreset: (name) => dispatch({ type: "SAVE_PRESET", payload: { name } }),
  };
}
