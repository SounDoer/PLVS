# Layout Ratio Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pixel-based split sizes with container-relative ratios so the layout restores correctly regardless of what window size the app was last closed at.

**Architecture:** `SplitNode.sizes` changes from `number[]` (0 = flex, n > 0 = fixed px) to `(number | null)[]` (null = flex, 0 < n ≤ 1 = fraction of parent container). The `SCALE_TREE_SIZES` reducer action and its `ResizeObserver` trigger are deleted since they are no longer needed. Drag-resize reads the parent container's `clientWidth`/`clientHeight` to convert the pixel delta back into a ratio before writing to the store. The localStorage key is bumped to v3 so stale pixel-based data is silently discarded on first launch.

**Tech Stack:** React, Vitest, Tailwind CSS

---

### Task 1: Update types, constants, and storage key

**Files:**
- Modify: `src/workspace/types.js`
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/constants.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `src/workspace/constants.test.js`:

```js
import { describe, it, expect } from "vitest";
import { WORKSPACE_STORAGE_KEY, BUILTIN_PRESETS } from "./constants.js";

describe("workspace localStorage keys", () => {
  it("uses plvs:workspace:v3 as WORKSPACE_STORAGE_KEY", () => {
    expect(WORKSPACE_STORAGE_KEY).toBe("plvs:workspace:v3");
  });
});

describe("BUILTIN_PRESETS ratio invariants", () => {
  function collectSplitNodes(node) {
    if (node.type === "leaf") return [];
    return [node, ...node.children.flatMap(collectSplitNodes)];
  }

  for (const preset of BUILTIN_PRESETS) {
    const splits = collectSplitNodes(preset.tree);

    it(`${preset.name}: all fixed sizes are ratios between 0 and 1`, () => {
      for (const s of splits) {
        for (const size of s.sizes) {
          if (size !== null) {
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThan(1);
          }
        }
      }
    });

    it(`${preset.name}: fixed ratios per split sum to less than 1`, () => {
      for (const s of splits) {
        const fixedSum = s.sizes.filter((v) => v !== null).reduce((a, b) => a + b, 0);
        expect(fixedSum).toBeLessThan(1);
      }
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/workspace/constants.test.js
```

Expected: FAIL — key is "plvs:workspace:v2", sizes are integers > 1.

- [ ] **Step 3: Update the typedef in `src/workspace/types.js`**

Change the `SplitNode` typedef line:

```js
// Before:
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: number[] }} SplitNode
// After:
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: (number | null)[] }} SplitNode
```

- [ ] **Step 4: Rewrite `src/workspace/constants.js`**

Replace the entire file with:

```js
/** @import { TreeNode, ModuleId, WorkspaceState, Preset } from './types.js' */

export const WORKSPACE_STORAGE_KEY = "plvs:workspace:v3";

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = [
  "peak",
  "loudness",
  "loudnessStats",
  "vectorscope",
  "spectrum",
  "spectrogram",
];

// ---------------------------------------------------------------------------
// Default tree — PLVS Full:
//   H[ leaf(peak) | V[ leaf(loudness) | leaf(spectrogram) | leaf(spectrum) ] | V[ leaf(loudnessStats) | leaf(vectorscope) ] ]
// Ratios: peak=20% of container width, right column=33%, middle fills remainder.
// ---------------------------------------------------------------------------

/** @type {TreeNode} */
export const DEFAULT_TREE = {
  type: "split",
  direction: "h",
  sizes: [0.20, null, 0.33],
  children: [
    { type: "leaf", tabs: ["peak"], activeTab: "peak" },
    {
      type: "split",
      direction: "v",
      sizes: [null, null, null],
      children: [
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["spectrogram"], activeTab: "spectrogram" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
      ],
    },
    {
      type: "split",
      direction: "v",
      sizes: [null, null],
      children: [
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
  ],
};

/** @type {Preset[]} */
export const BUILTIN_PRESETS = [
  {
    id: "default",
    name: "PLVS Full",
    builtin: true,
    visibleModules: [...ALL_MODULE_IDS],
    tree: DEFAULT_TREE,
  },
  {
    id: "lls",
    name: "LLS",
    builtin: true,
    visibleModules: ["loudness", "loudnessStats", "spectrum"],
    tree: {
      type: "split",
      direction: "h",
      sizes: [null, 0.26],
      children: [
        {
          type: "split",
          direction: "v",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
            { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          ],
        },
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
      ],
    },
  },
  {
    id: "pllv",
    name: "PLLV",
    builtin: true,
    visibleModules: ["peak", "loudness", "loudnessStats", "vectorscope"],
    tree: {
      type: "split",
      direction: "h",
      sizes: [0.18, null, 0.33],
      children: [
        {
          type: "split",
          direction: "v",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["peak"], activeTab: "peak" },
            { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
          ],
        },
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
      ],
    },
  },
];

/** @type {WorkspaceState} */
export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  visibleModules: [...ALL_MODULE_IDS],
  focusId: null,
  activePresetId: "default",
  fullscreenId: null,
  customPresets: [],
};
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/workspace/constants.test.js
```

Expected: PASS (3 preset × 2 invariant tests = 6 tests, plus the key test = 7 total).

- [ ] **Step 6: Commit**

```
git add src/workspace/types.js src/workspace/constants.js src/workspace/constants.test.js
git commit -m "feat(layout): switch SplitNode sizes from px to container ratios"
```

---

### Task 2: Update treeUtils — new splits use `null` instead of `0`

**Files:**
- Modify: `src/workspace/treeUtils.js`
- Modify: `src/workspace/treeUtils.test.js`

`insertLeaf` creates new `SplitNode`s in three places, all with `sizes: [0, 0]`. These need to become `sizes: [null, null]`. Promotion also splices `0` into an existing sizes array; that becomes `null`.

- [ ] **Step 1: Update the sizes assertions in `src/workspace/treeUtils.test.js`**

Find the describe block `"insertLeaf: new splits use flex-fill sizes (0), not fixed 200px"` (near the bottom of the file) and replace it entirely:

```js
describe("insertLeaf: new splits use flex-fill sizes (null), not fixed px", () => {
  it("wrapping root leaf in a new split uses sizes [null, null]", () => {
    const result = insertLeaf(leaf(["loudness"]), [], "right", leaf(["peak"]));
    expect(result?.sizes).toEqual([null, null]);
  });

  it("wrapping a nested leaf in a new split uses sizes [null, null]", () => {
    // H[A, B] — drop above B — B gets wrapped in V[new, B]; inner split sizes [null, null]
    const root = split("h", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [1], "above", leaf(["peak"]));
    expect(result?.children[1].sizes).toEqual([null, null]);
  });

  it("promotion into existing split inserts new sibling with size null", () => {
    // H[A, B] — drop right of A — promotes to H[A, new, B]; new size is null
    const root = split("h", [leaf(["loudness"]), leaf(["spectrum"])], [null, null]);
    const result = insertLeaf(root, [0], "right", leaf(["peak"]));
    expect(result?.sizes[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/workspace/treeUtils.test.js
```

Expected: FAIL on the three new-sizes tests — `treeUtils.js` still produces `0`.

- [ ] **Step 3: Update `src/workspace/treeUtils.js`**

There are three lines to change. All are in `insertLeaf`:

**Line 169** — wrapping root:
```js
// Before:
    return { type: "split", direction: dir, children, sizes: [0, 0] };
// After:
    return { type: "split", direction: dir, children, sizes: [null, null] };
```

**Line 183** — promotion splice:
```js
// Before:
      newSizes.splice(insertAt, 0, 0);
// After:
      newSizes.splice(insertAt, 0, null);
```

**Line 192** — wrapping non-root leaf:
```js
// Before:
    return { type: "split", direction: dir, children, sizes: [0, 0] };
// After:
    return { type: "split", direction: dir, children, sizes: [null, null] };
```

- [ ] **Step 4: Run all treeUtils tests to verify they pass**

```
npx vitest run src/workspace/treeUtils.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add src/workspace/treeUtils.js src/workspace/treeUtils.test.js
git commit -m "feat(layout): insertLeaf uses null flex-fill sizes"
```

---

### Task 3: Remove scaling logic from reducer

**Files:**
- Modify: `src/workspace/reducer.js`
- Modify: `src/workspace/reducer-tree.test.js`

`scaleTreeSizes` and the `SCALE_TREE_SIZES` action are dead code once sizes are ratios. The `split` helper in the test file uses `200` as a default size, which is no longer a meaningful value — update it to `null`.

- [ ] **Step 1: Update the `split` helper and `RESIZE_CHILDREN` tests in `src/workspace/reducer-tree.test.js`**

Change the `split` helper at the top of the file:

```js
// Before:
function split(direction, children, sizes) {
  return { type: "split", direction, children, sizes: sizes ?? children.map(() => 200) };
}
// After:
function split(direction, children, sizes) {
  return { type: "split", direction, children, sizes: sizes ?? children.map(() => null) };
}
```

Update the two `RESIZE_CHILDREN` tests to use ratio values:

```js
describe("RESIZE_CHILDREN", () => {
  it("updates sizes of adjacent children in a SplitNode at root", () => {
    const root = split("v", [leaf(["peak"]), leaf(["loudness"])], [0.5, 0.5]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: { path: [], aboveIdx: 0, aboveSize: 0.7, belowSize: 0.3 },
    });
    expect(next.tree.sizes[0]).toBe(0.7);
    expect(next.tree.sizes[1]).toBe(0.3);
  });

  it("updates sizes in a nested SplitNode", () => {
    const inner = split("h", [leaf(["peak"]), leaf(["loudness"])], [0.4, 0.4]);
    const root = split("v", [inner, leaf(["spectrum"])]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: { path: [0], aboveIdx: 0, aboveSize: 0.6, belowSize: 0.25 },
    });
    expect(next.tree.children[0].sizes[0]).toBe(0.6);
    expect(next.tree.children[0].sizes[1]).toBe(0.25);
    expect(next.tree.children[1]).toBe(root.children[1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (no failures expected from test changes alone)**

```
npx vitest run src/workspace/reducer-tree.test.js
```

Expected: all PASS — the reducer stores whatever values it receives, so ratio values work fine already.

- [ ] **Step 3: Remove `scaleTreeSizes`, `SCALE_TREE_SIZES`, and `scaleSizes` from `src/workspace/reducer.js`**

Delete the entire `scaleTreeSizes` function (lines 9–30):

```js
// Delete this entire block:
function scaleTreeSizes(node, scaleX, scaleY) {
  if (node.type === "leaf") return node;
  const scale = node.direction === "h" ? scaleX : scaleY;

  const allFixed = node.sizes.every((s) => s > 0);
  const newSizes = node.sizes.map((s, i) => {
    if (s === 0) return 0;
    if (allFixed && i === node.sizes.length - 1) return 0;
    return Math.max(80, Math.round(s * scale));
  });

  const newChildren = node.children.map((c) => scaleTreeSizes(c, scaleX, scaleY));
  if (
    newSizes.every((s, i) => s === node.sizes[i]) &&
    newChildren.every((c, i) => c === node.children[i])
  ) {
    return node;
  }
  return { ...node, sizes: newSizes, children: newChildren };
}
```

Delete the `SCALE_TREE_SIZES` case from the reducer:

```js
// Delete this entire case:
    case "SCALE_TREE_SIZES": {
      const { scaleX, scaleY } = action.payload;
      const newTree = scaleTreeSizes(state.tree, scaleX, scaleY);
      return newTree === state.tree ? state : { ...state, tree: newTree };
    }
```

Delete `scaleSizes` from `bindWorkspaceActions`:

```js
// Before:
    scaleSizes: (scaleX, scaleY) =>
      dispatch({ type: "SCALE_TREE_SIZES", payload: { scaleX, scaleY } }),
// After: (delete the two lines above entirely)
```

- [ ] **Step 4: Run all reducer tests to verify nothing broke**

```
npx vitest run src/workspace/reducer-tree.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add src/workspace/reducer.js src/workspace/reducer-tree.test.js
git commit -m "feat(layout): remove SCALE_TREE_SIZES — ratios are inherently scale-invariant"
```

---

### Task 4: Update SplitLayout — render ratios, write ratios on drag

**Files:**
- Modify: `src/workspace/SplitLayout.jsx`

No unit tests exist for this component. Verification is done by running the app.

Two changes:
1. `SplitView` child style: use `flex-basis: ${ratio*100}%` instead of `${size}px`.
2. `SplitDivider` drag: read parent container size and write back ratios.
3. `SplitContent`: remove `scaleSizes`, `scaleSizesRef`, `prevContainerSizeRef`, and the scaling `ResizeObserver`.

- [ ] **Step 1: Update `childStyle` in `SplitView`**

Find this block in `SplitView` (around line 98):

```js
        const size = node.sizes[i];
        const childStyle =
          size > 0
            ? { flex: `0 0 ${size}px`, minWidth: 0, minHeight: 0 }
            : { flex: "1 1 0", minWidth: 0, minHeight: 0 };
```

Replace with:

```js
        const size = node.sizes[i];
        const childStyle =
          size !== null
            ? { flex: `0 0 ${size * 100}%`, minWidth: 0, minHeight: 0 }
            : { flex: "1 1 0", minWidth: 0, minHeight: 0 };
```

- [ ] **Step 2: Update `handleMouseDown` in `SplitDivider` to compute ratios**

Replace the entire `handleMouseDown` function body (everything from `e.preventDefault()` through the `window.addEventListener` calls) with:

```js
  function handleMouseDown(e) {
    e.preventDefault();
    const aboveEl = ref.current?.previousElementSibling;
    const belowEl = ref.current?.nextElementSibling;
    if (!aboveEl || !belowEl) return;

    const containerEl = ref.current.parentElement;
    const startAbovePx = isH ? aboveEl.clientWidth : aboveEl.clientHeight;
    const startBelowPx = isH ? belowEl.clientWidth : belowEl.clientHeight;
    const containerPx = isH ? containerEl.clientWidth : containerEl.clientHeight;
    const startPos = isH ? e.clientX : e.clientY;
    const dimension = isH ? "minWidth" : "minHeight";
    const { visibleModules } = state;

    const minAbove = getSubtreeMinSize(aboveNode, visibleModules, dimension);
    const minBelow = getSubtreeMinSize(belowNode, visibleModules, dimension);

    function onMove(ev) {
      const delta = (isH ? ev.clientX : ev.clientY) - startPos;
      const clampedDelta = Math.min(
        Math.max(delta, -(startAbovePx - minAbove)),
        startBelowPx - minBelow
      );
      resizeChildren(
        parentPath,
        aboveIdx,
        (startAbovePx + clampedDelta) / containerPx,
        (startBelowPx - clampedDelta) / containerPx
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
```

- [ ] **Step 3: Simplify `SplitContent` — remove scaling infrastructure**

In `SplitContent`, make these deletions:

**Line 174** — remove `scaleSizes` from the destructure:
```js
// Before:
  const { state, moveTab, setFullscreen, scaleSizes } = useWorkspaceStore();
// After:
  const { state, moveTab, setFullscreen } = useWorkspaceStore();
```

**Lines 206–229** — delete the entire scaling ResizeObserver block:
```js
// Delete this entire block:
  // Scale stored pixel sizes proportionally when the layout container is resized
  const mainRef = useRef(null);
  const prevContainerSizeRef = useRef(null);
  const scaleSizesRef = useRef(scaleSizes);
  scaleSizesRef.current = scaleSizes;

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const prev = prevContainerSizeRef.current;
        if (prev && prev.width > 0 && prev.height > 0) {
          const scaleX = width / prev.width;
          const scaleY = height / prev.height;
          if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
            scaleSizesRef.current(scaleX, scaleY);
          }
        }
        prevContainerSizeRef.current = { width, height };
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

**In the JSX return** — remove `ref={mainRef}` from the `<main>` element:
```jsx
// Before:
      <main ref={mainRef} className="relative flex min-h-0 flex-1 overflow-hidden">
// After:
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
```

- [ ] **Step 4: Run the full test suite**

```
npm test
```

Expected: all tests PASS. (No unit tests cover SplitLayout directly.)

- [ ] **Step 5: Run the app and verify visually**

```
npm run dev
```

Check:
- Default PLVS Full layout opens with ~20% peak column on the left, ~33% stats column on the right
- Dragging a divider resizes panels smoothly
- Closing and reopening the app at the same window size restores the layout correctly
- Closing at one window size, resizing the window, and reopening restores the correct proportional layout (this is the regression that motivated this change)
- Applying a preset (LLS, PLLV) switches layouts correctly

- [ ] **Step 6: Commit**

```
git add src/workspace/SplitLayout.jsx
git commit -m "feat(layout): render ratios as %, write ratios on drag-resize"
```
