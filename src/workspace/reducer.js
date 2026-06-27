/** @import { WorkspaceState, DropTarget, TreeNode } from './types.js' */
import {
  createDefaultPanelControls,
  normalizePanelControlsById,
  updatePanelControlsById,
} from "./panelControlInstances.js";
import { createPanel, trimCustomTitle } from "./panelInstances.js";
import { findLeafWithTab, insertLeaf, removeTab, updateNode } from "./treeUtils.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";

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

export function normalizePinnedPanelsById(panelsById, pinnedPanelsById) {
  if (!pinnedPanelsById || typeof pinnedPanelsById !== "object") return {};
  return Object.fromEntries(
    Object.entries(pinnedPanelsById)
      .filter(([id, size]) => {
        if (!panelsById[id]) return false;
        return Number.isFinite(size?.width) && Number.isFinite(size?.height);
      })
      .map(([id, size]) => [
        id,
        {
          width: Math.max(0, size.width),
          height: Math.max(0, size.height),
        },
      ])
  );
}

function getPinnedPanelIdsInNode(node, pinnedPanelsById, dimension) {
  if (!node || !pinnedPanelsById) return [];
  if (node.type === "leaf") return node.tabs.filter((id) => pinnedPanelsById[id]);
  // A pinned panel's height is owned by its nearest enclosing v-split (width by
  // its nearest h-split). When a resize changes this node's size along `dimension`,
  // a pinned panel nested past a same-direction split keeps its own pinned size and
  // must not be rewritten — otherwise dragging an outer divider stretches the pin to
  // the whole region and collapses its sibling.
  const consumesDimension =
    (node.direction === "h" && dimension === "width") ||
    (node.direction === "v" && dimension === "height");
  if (consumesDimension) return [];
  return node.children.flatMap((child) =>
    getPinnedPanelIdsInNode(child, pinnedPanelsById, dimension)
  );
}

function updatePinnedDimensionForNode(pinnedPanelsById, node, dimension, px) {
  if (!Number.isFinite(px)) return pinnedPanelsById;
  const ids = getPinnedPanelIdsInNode(node, pinnedPanelsById, dimension);
  if (ids.length === 0) return pinnedPanelsById;
  const next = { ...pinnedPanelsById };
  for (const id of ids) {
    next[id] = { ...next[id], [dimension]: Math.max(0, px) };
  }
  return next;
}

function applySplitSnapshots(tree, splitSnapshots) {
  if (!tree || !Array.isArray(splitSnapshots)) return tree;
  return splitSnapshots.reduce((nextTree, snapshot) => {
    const { path, childIdx, mode, children } = snapshot ?? {};
    if (!Array.isArray(path) || !Array.isArray(children)) return nextTree;
    const visibleChildren = children.filter(
      (child) => Number.isInteger(child?.childIdx) && Number.isFinite(child?.sizePx)
    );
    const contentPx = visibleChildren.reduce((sum, child) => sum + child.sizePx, 0);
    if (contentPx <= 0) return nextTree;
    return updateNode(nextTree, path, (node) => {
      if (node.type !== "split") return node;
      const sizes = [...node.sizes];
      const pinnedSizePx =
        mode === "pin" ? visibleChildren.find((child) => child.childIdx === childIdx)?.sizePx : 0;
      const availablePx = Math.max(0, contentPx - (pinnedSizePx ?? 0));
      for (const child of visibleChildren) {
        if (child.childIdx < 0 || child.childIdx >= sizes.length) continue;
        if (mode === "pin" && child.childIdx === childIdx) continue;
        const divisor = mode === "pin" ? availablePx : contentPx;
        if (divisor <= 0) continue;
        sizes[child.childIdx] = Math.max(0, child.sizePx / divisor);
      }
      return { ...node, sizes };
    });
  }, tree);
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
      const { path, aboveIdx, belowIdx, aboveSize, belowSize, direction, abovePx, belowPx } =
        action.payload;
      const actualBelowIdx = belowIdx ?? aboveIdx + 1;
      let pinnedPanelsById = state.pinnedPanelsById ?? {};
      const newTree = updateNode(state.tree, path, (node) => {
        const sizes = [...node.sizes];
        sizes[aboveIdx] = aboveSize;
        sizes[actualBelowIdx] = belowSize;
        if (direction === "h" || direction === "v") {
          const dimension = direction === "h" ? "width" : "height";
          pinnedPanelsById = updatePinnedDimensionForNode(
            pinnedPanelsById,
            node.children[aboveIdx],
            dimension,
            abovePx
          );
          pinnedPanelsById = updatePinnedDimensionForNode(
            pinnedPanelsById,
            node.children[actualBelowIdx],
            dimension,
            belowPx
          );
        }
        return { ...node, sizes };
      });
      return { ...state, tree: newTree, pinnedPanelsById };
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
      const { [id]: _removedPinned, ...pinnedPanelsById } = state.pinnedPanelsById ?? {};
      return {
        ...state,
        tree: state.tree ? removeTab(state.tree, id) : null,
        panelsById,
        panelOrder: state.panelOrder.filter((panelId) => panelId !== id),
        panelControlsById,
        pinnedPanelsById,
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
      const { tree, panelsById, panelOrder, panelControlsById, pinnedPanelsById } = action.payload;
      return {
        ...state,
        tree,
        panelsById,
        panelOrder,
        panelControlsById: normalizePanelControlsById(panelsById, panelControlsById),
        pinnedPanelsById: normalizePinnedPanelsById(panelsById, pinnedPanelsById),
        fullscreenId: null,
      };
    }

    case "SET_PANEL_PINNED": {
      const { id, size, splitSnapshots } = action.payload;
      if (!state.panelsById[id]) return state;
      const pinnedPanelsById = { ...(state.pinnedPanelsById ?? {}) };
      if (size == null) {
        delete pinnedPanelsById[id];
      } else {
        const normalized = normalizePinnedPanelsById(state.panelsById, { [id]: size })[id];
        if (!normalized) return state;
        pinnedPanelsById[id] = normalized;
      }
      return { ...state, tree: applySplitSnapshots(state.tree, splitSnapshots), pinnedPanelsById };
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

    case "RESET_WORKSPACE":
      return { ...DEFAULT_WORKSPACE_STATE };

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
    resizeChildren: (path, aboveIdx, belowIdx, aboveSize, belowSize, metadata) =>
      dispatch({
        type: "RESIZE_CHILDREN",
        payload: { path, aboveIdx, belowIdx, aboveSize, belowSize, ...metadata },
      }),
    setView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
    setPanelPinned: (id, size, metadata) =>
      dispatch({ type: "SET_PANEL_PINNED", payload: { id, size, ...metadata } }),
    setPanelControlsForPanel: (id, panelControls) =>
      dispatch({ type: "SET_PANEL_CONTROLS_FOR_PANEL", payload: { id, panelControls } }),
    setPanelControls: (panelControls) =>
      dispatch({ type: "SET_PANEL_CONTROLS", payload: { panelControls } }),
    resetWorkspace: () => dispatch({ type: "RESET_WORKSPACE" }),
  };
}
