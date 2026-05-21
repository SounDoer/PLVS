/**
 * Pure functions for manipulating the split-tree workspace layout.
 * All functions are immutable — they never modify their inputs.
 *
 * @import { TreeNode, SplitNode, LeafNode } from './types.js'
 */

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function getNode(root, path) {
  if (path.length === 0) return root;
  const [idx, ...rest] = path;
  return getNode(root.children[idx], rest);
}

// ---------------------------------------------------------------------------
// updateNode
// ---------------------------------------------------------------------------

/**
 * Immutable update of the node at `path`.
 * `path = []` updates the root itself.
 *
 * @param {TreeNode} root
 * @param {number[]} path
 * @param {(node: TreeNode) => TreeNode} updater
 * @returns {TreeNode}
 */
export function updateNode(root, path, updater) {
  if (path.length === 0) return updater(root);
  const [idx, ...rest] = path;
  const newChildren = [...root.children];
  newChildren[idx] = updateNode(newChildren[idx], rest, updater);
  return { ...root, children: newChildren };
}

// ---------------------------------------------------------------------------
// findLeafWithTab
// ---------------------------------------------------------------------------

/**
 * Returns the path to the leaf containing `tabId`, or null if not found.
 *
 * @param {TreeNode} root
 * @param {string} tabId
 * @returns {number[] | null}
 */
export function findLeafWithTab(root, tabId) {
  if (root.type === "leaf") {
    return root.tabs.includes(tabId) ? [] : null;
  }
  for (let i = 0; i < root.children.length; i++) {
    const found = findLeafWithTab(root.children[i], tabId);
    if (found !== null) return [i, ...found];
  }
  return null;
}

// ---------------------------------------------------------------------------
// pruneTree
// ---------------------------------------------------------------------------

/**
 * Removes empty leaves and unwraps single-child SplitNodes.
 * Returns null if the entire tree is empty.
 *
 * @param {TreeNode} root
 * @returns {TreeNode | null}
 */
export function pruneTree(root) {
  if (root.type === "leaf") {
    return root.tabs.length > 0 ? root : null;
  }
  const prunedPairs = root.children.map((child, i) => ({
    child: pruneTree(child),
    size: root.sizes[i],
  }));
  const valid = prunedPairs.filter(({ child }) => child !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0].child;
  return {
    ...root,
    children: valid.map(({ child }) => child),
    sizes: valid.map(({ size }) => size),
  };
}

// ---------------------------------------------------------------------------
// removeTab
// ---------------------------------------------------------------------------

/**
 * Removes `tabId` from the tree. Prunes empty leaves and unwraps
 * single-child splits. Returns the original tree if tab not found,
 * or null if the tree becomes empty.
 *
 * @param {TreeNode} root
 * @param {string} tabId
 * @returns {TreeNode | null}
 */
export function removeTab(root, tabId) {
  const path = findLeafWithTab(root, tabId);
  if (path === null) return root;

  const targetLeaf = getNode(root, path);
  const newTabs = targetLeaf.tabs.filter((t) => t !== tabId);

  if (newTabs.length > 0) {
    const newActiveTab = newTabs.includes(targetLeaf.activeTab) ? targetLeaf.activeTab : newTabs[0];
    return updateNode(root, path, () => ({
      ...targetLeaf,
      tabs: newTabs,
      activeTab: newActiveTab,
    }));
  }

  // Leaf becomes empty — remove it from parent
  if (path.length === 0) return null;

  const parentPath = path.slice(0, -1);
  const leafIdx = path[path.length - 1];
  const newRoot = updateNode(root, parentPath, (parent) => {
    const newChildren = parent.children.filter((_, i) => i !== leafIdx);
    const newSizes = parent.sizes.filter((_, i) => i !== leafIdx);
    return { ...parent, children: newChildren, sizes: newSizes };
  });

  return pruneTree(newRoot);
}

// ---------------------------------------------------------------------------
// insertLeaf
// ---------------------------------------------------------------------------

const ZONE_DIR = { above: "v", below: "v", left: "h", right: "h" };
const ZONE_BEFORE = { above: true, left: true, below: false, right: false };

/**
 * Inserts `newLeaf` relative to the node at `targetPath`.
 *
 * - zone='tabs': merges newLeaf.tabs into the target leaf at `tabIndex`
 * - zone='above'/'below'/'left'/'right': creates a split, with promotion
 *   when the parent SplitNode already has the matching direction
 *
 * @param {TreeNode} root
 * @param {number[]} targetPath
 * @param {'tabs'|'above'|'below'|'left'|'right'} zone
 * @param {LeafNode} newLeaf
 * @param {number} [tabIndex]
 * @returns {TreeNode}
 */
export function insertLeaf(root, targetPath, zone, newLeaf, tabIndex = 0) {
  if (zone === "tabs") {
    return updateNode(root, targetPath, (target) => {
      const tabs = [...target.tabs];
      tabs.splice(tabIndex, 0, ...newLeaf.tabs);
      return { ...target, tabs, activeTab: newLeaf.activeTab ?? newLeaf.tabs[0] };
    });
  }

  const dir = ZONE_DIR[zone];
  const before = ZONE_BEFORE[zone];

  // Target is root — always wrap in a new split
  if (targetPath.length === 0) {
    const children = before ? [newLeaf, root] : [root, newLeaf];
    return { type: "split", direction: dir, children, sizes: [null, null] };
  }

  const parentPath = targetPath.slice(0, -1);
  const targetIdx = targetPath[targetPath.length - 1];
  const parent = getNode(root, parentPath);

  if (parent.direction === dir) {
    // Promotion: insert as sibling in the existing split
    const insertAt = before ? targetIdx : targetIdx + 1;
    return updateNode(root, parentPath, (p) => {
      const newChildren = [...p.children];
      const newSizes = [...p.sizes];
      newChildren.splice(insertAt, 0, newLeaf);
      newSizes.splice(insertAt, 0, null);
      return { ...p, children: newChildren, sizes: newSizes };
    });
  }

  // No promotion — wrap target leaf in a new split
  return updateNode(root, targetPath, (target) => {
    const children = before ? [newLeaf, target] : [target, newLeaf];
    return { type: "split", direction: dir, children, sizes: [null, null] };
  });
}
