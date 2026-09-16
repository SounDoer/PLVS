# Split-Tree Layout — Design Spec

**Date:** 2026-05-15  
**Status:** Approved for implementation  
**Replaces:** Fixed 4-region Dock+Tabs model

---

## Summary

Replace the current fixed left/center/right/bottom region model with a fully recursive N-ary split tree. Any leaf (tab group) can be split horizontally or vertically by dragging a tab to an edge. There are no named regions; the entire workspace is one tree rooted at a single node.

---

## Goals

- Any panel can be split H or V, to any depth
- Drag a tab to an edge of any leaf → create a new split
- Empty leaves auto-disappear; their space is absorbed by siblings
- No named regions (left, right, bottom are gone)
- Preset system and `visibleModules` toggling continue to work unchanged
- Old localStorage state silently resets to default (no migration)
- Collapse feature removed

## Non-Goals

- Touch / pointer events (out of scope)
- Undo/redo
- Saving window-level size state across resizes (sizes are pixel-based and clamp on load)

---

## Data Model

### TreeNode

```ts
type TreeNode = SplitNode | LeafNode

// A container that lays out its children in a direction
interface SplitNode {
  type: 'split'
  direction: 'h' | 'v'     // h = side-by-side, v = stacked
  children: TreeNode[]      // always length >= 2
  sizes: number[]           // pixel size per child; last child gets flex-1 (its size entry is ignored at render)
}

// A tab group (leaf of the tree)
interface LeafNode {
  type: 'leaf'
  tabs: ModuleId[]
  activeTab: ModuleId
}
```

Invariants:
- `SplitNode.children.length >= 2` always (single-child splits are unwrapped immediately)
- `LeafNode.tabs.length >= 1` always (empty leaves are removed immediately)
- `sizes.length === children.length` always (but `sizes[children.length - 1]` is unused by the renderer)

### WorkspaceState changes

```ts
// Before
WorkspaceState.dock: DockState  // { regions: { left, center, right, bottom } }

// After
WorkspaceState.tree: TreeNode
```

Fields removed: `dock`, `DockState`, `Region`, `RegionKey`, `Slot.collapsed`  
Fields unchanged: `visibleModules`, `focusId`, `fullscreenId`, `activePresetId`, `customPresets`

### Preset shape change

```ts
// Before
Preset.dock: DockState

// After
Preset.tree: TreeNode
```

All `BUILTIN_PRESETS` are rewritten to use the `tree` field.

### Storage key

Bump to `audiometer:workspace:v2`. On load, if the parsed object lacks a `tree` field (old v1 format), silently use `DEFAULT_WORKSPACE_STATE`.

---

## Default Layout

The default tree replicates the current Default preset layout:

```
SplitNode h [
  LeafNode [peak, vectorscope]            size=220
  SplitNode v [
    LeafNode [loudness]                   size=flex
    LeafNode [spectrum, spectrogram]      size=flex
  ]                                       size=flex (grows)
  LeafNode [loudnessStats]               size=260
]
```

---

## Tree Utility Functions

New file: `src/workspace/treeUtils.js` — pure functions, no side effects.

```js
// Immutable update of the node at path
updateNode(root, path, updater): TreeNode

// Find a node and return its path, or null
findLeafWithTab(root, tabId): number[] | null

// Remove tabId from its leaf; prune empty leaves and unwrap single-child splits
removeTab(root, tabId): TreeNode | null

// Insert a new leaf at the given path with the given zone
// Returns the new tree root
insertLeaf(root, targetPath, zone, newLeaf): TreeNode

// Prune upward: remove empty leaves, unwrap single-child splits
pruneTree(root): TreeNode | null

// Validate invariants (dev-only)
assertTreeValid(root): void
```

---

## Key Algorithms

### Promotion (avoid unnecessary nesting)

When inserting a new leaf via `insertLeaf` with zone `above`, `below`, `left`, or `right`:

1. Look at the **parent** of the target leaf.
2. If the parent is a `SplitNode` whose direction matches the drop direction (`above`/`below` → `v`, `left`/`right` → `h`), insert the new leaf as a sibling in the existing split instead of wrapping.
3. Otherwise, replace the target leaf with a new `SplitNode` containing [target, new] (or [new, target] for above/left).

Example:
```
Before: V[A, B, C]
Drop "above B" → parent is V-split → insert sibling
After:  V[A, new, B, C]   ✓

Drop "right of B" → parent is V-split (doesn't match H) → wrap
After:  V[A, H[B, new], C]   ✓
```

### Unwrapping (keep tree clean after removal)

After removing a tab from a leaf:
1. If the leaf's `tabs` is now empty → remove the leaf from its parent.
2. If the parent `SplitNode` now has 1 child → replace the `SplitNode` with its sole child (unwrap).
3. Repeat step 2 upward until stable or root.

If the root itself becomes a single-leaf tree, that's valid — the root is just a `LeafNode`.

If `removeTab` empties the entire tree (all modules hidden), return a sentinel "empty root" — `null`. The renderer shows an empty workspace placeholder.

---

## Size Management

- `SplitNode.sizes` stores pixel sizes for each child.
- At render time, last child gets `flex: 1 1 auto`; others get `flex: 0 0 {size}px`.
- This is identical to the current `isLast` strategy, now generalized to the whole tree.
- On window resize: no active normalization. The last-child flex-1 absorbs slack. Explicit sizes are only clamped during drag (min-size enforcement from `MODULE_REGISTRY`).
- When a new split is created, the initial sizes are derived by halving the target leaf's current rendered size (`el.clientWidth` or `el.clientHeight`).

### Divider resize action

Replace `SET_REGION_SIZE` + `SET_SLOT_SIZE` with a single unified action:

```js
RESIZE_CHILDREN(path, aboveIdx, aboveSize, belowSize)
```

`path` is the path to the `SplitNode`. `aboveIdx` and `belowIdx = aboveIdx + 1`. Both sizes are updated atomically to preserve the sum (same `clampedDelta` logic as current `SlotDivider`).

---

## Drag & Drop

### Drop zones on a LeafNode

When dragging, each visible `LeafNode` exposes 5 hit zones (derived from mouse position relative to the leaf's bounding rect):

| Zone | Trigger | Result |
|------|---------|--------|
| `tabs` | Cursor in tab bar | Merge tab into this leaf |
| `above` | Top 20% of body | New leaf above (V) |
| `below` | Bottom 20% of body | New leaf below (V) |
| `left` | Left 20% of body | New leaf left (H) |
| `right` | Right 20% of body | New leaf right (H) |

The center 60% of the body (between the four 20% edge strips) maps to `above`/`below`/`left`/`right` based on whichever edge the cursor is closest to.

### hoverDrop shape (new)

```ts
// Before
{ targetRegion, slotIndex, zone: 'tabs'|'above'|'below'|'empty-region', tabIndex? }

// After
{ targetPath: number[], zone: 'tabs'|'above'|'below'|'left'|'right', tabIndex? }
```

### DOM attributes (new)

```html
<!-- LeafNode element -->
<div data-leaf data-leaf-path="[0,1]" ...>
```

`computeDropTarget` reads `data-leaf-path` and parses it as `JSON.parse`.

### Empty workspace drop

Modules are never removed from the tree when hidden — `visibleModules` controls visibility independently. If all modules are hidden, the workspace shows a full-area placeholder. Dropping a tab ghost onto this placeholder is treated as dropping onto the tab's existing leaf (the tree structure is preserved even when all tabs are hidden).

---

## Reducer Changes

### Actions removed
- `SET_DOCK_STATE`
- `SET_REGION_SIZE`
- `SET_SLOT_SIZE`
- `TOGGLE_SLOT_COLLAPSED`

### Actions renamed / changed
- `MOVE_TAB` — payload changes: `drop` now uses `targetPath` + new zones
- `SET_ACTIVE_TAB` — payload changes: `path` replaces `region` + `slotIndex`
- `APPLY_PRESET` — reads `preset.tree` instead of `preset.dock`
- `SAVE_PRESET` — stores `state.tree` instead of `state.dock`

### Actions added
- `RESIZE_CHILDREN` — `{ path, aboveIdx, aboveSize, belowSize }`
- `SET_TREE` — `{ tree }` (replaces `SET_DOCK_STATE`, used when applying a full tree)

### `TOGGLE_MODULE_VISIBLE` behavior change

Currently it auto-expands collapsed slots. With the new model: no collapsed state exists. When re-showing a module, call `SET_FOCUS` to activate the tab in its leaf.

### `SET_FOCUS` behavior change

Currently traverses `dock.regions`. Now traverses `tree` using `findLeafWithTab`. Sets `activeTab` on the found leaf via `updateNode`.

---

## Component Changes

### File renames / replacements

| Old file | New file | Change |
|----------|----------|--------|
| `DockLayout.jsx` | `SplitLayout.jsx` | Full rewrite |
| `DockSlot.jsx` | `LeafView.jsx` | Significant changes |
| `DragContext.jsx` | `DragContext.jsx` | Update `computeDropTarget`, `hoverDrop` shape |
| `reducer.js` | `reducer.js` | Significant rewrite |
| `constants.js` | `constants.js` | New default state + presets |
| `types.js` | `types.js` | New types, old types removed |
| *(new)* | `treeUtils.js` | Pure tree functions |

### SplitLayout.jsx

Replaces `DockLayout.jsx`. Renders the tree recursively:

```jsx
function SplitView({ node, path }) {
  if (node.type === 'leaf') return <LeafView node={node} path={path} />;
  return (
    <div className={cn('flex min-h-0', node.direction === 'h' ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, i) => {
        const isLast = i === node.children.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <SplitDivider path={path} aboveIdx={i - 1} belowIdx={i} direction={node.direction} />}
            <SplitView node={child} path={[...path, i]} isLast={isLast} />
          </Fragment>
        );
      })}
    </div>
  );
}
```

`SplitDivider` replaces both `DockDivider` and `SlotDivider`. It dispatches `RESIZE_CHILDREN`.

### LeafView.jsx

Replaces `DockSlot.jsx`. Props: `node: LeafNode`, `path: number[]`, `isLast: boolean`.

Changes vs `DockSlot`:
- `regionKey` + `slotIndex` → `path`
- Collapse button removed
- Drop zones extended: adds `left`/`right` visual hints
- `data-slot` → `data-leaf`, `data-slot-index` → `data-leaf-path={JSON.stringify(path)}`

### WorkspaceToolbar.jsx

No changes needed. `VisibilityPopover` and `PresetDropdown` continue to work via `toggleModuleVisible` and `applyPreset`.

---

## Visibility vs Tree Structure

Modules remain in the tree even when hidden via `visibleModules`. The renderer skips hidden tabs in a leaf's tab bar. A leaf where all tabs are hidden is rendered as an invisible zero-size element (not removed from the tree).

This preserves the user's layout when they toggle modules off and on.

Exception: when a tab is **dragged** to a new location, the source leaf is truly modified (tab removed). If the leaf empties, it is pruned from the tree.

---

## Files Affected (summary)

- **New:** `src/workspace/treeUtils.js`
- **Major rewrite:** `src/workspace/SplitLayout.jsx` (from `DockLayout.jsx`)
- **Major rewrite:** `src/workspace/LeafView.jsx` (from `DockSlot.jsx`)
- **Major rewrite:** `src/workspace/reducer.js`
- **Significant:** `src/workspace/DragContext.jsx`
- **Significant:** `src/workspace/constants.js`
- **Moderate:** `src/workspace/types.js`
- **Minimal:** `src/workspace/WorkspaceContext.jsx` (just state shape)
- **Minimal:** `src/workspace/WorkspaceToolbar.jsx` (no changes expected)
- **Delete after migration:** `DockLayout.jsx`, `DockSlot.jsx` (superseded)
