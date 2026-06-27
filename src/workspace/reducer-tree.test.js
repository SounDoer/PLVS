/**
 * Tests for the tree-based workspace reducer (replaces dock-based reducer.test.js).
 */
import { describe, it, expect } from "vitest";
import { workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { findLeafWithTab } from "./treeUtils.js";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leaf(tabs, activeTab = tabs[0]) {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

function split(direction, children, sizes) {
  return { type: "split", direction, children, sizes: sizes ?? children.map(() => null) };
}

function state(tree, extra = {}) {
  return { ...DEFAULT_WORKSPACE_STATE, tree, ...extra };
}

function expectPanelControlsIsolated(actual, source) {
  const normalizedSource = normalizePanelControls(source);
  expect(actual).toEqual(normalizedSource);
  expect(actual).not.toBe(source);
  expect(actual.vectorscopePair).not.toBe(source.vectorscopePair);
  expect(actual.spectrumChannel).not.toBe(source.spectrumChannel);
  expect(actual.statsVisibleIds).not.toBe(source.statsVisibleIds);
  expect(actual.loudnessHistoryVisibleLayerIds).not.toBe(source.loudnessHistoryVisibleLayerIds);
}

// ---------------------------------------------------------------------------
// SET_TREE
// ---------------------------------------------------------------------------

describe("SET_TREE", () => {
  it("replaces the entire tree", () => {
    const newTree = leaf(["levelMeter"]);
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_TREE",
      payload: { tree: newTree },
    });
    expect(next.tree).toBe(newTree);
  });
});

// ---------------------------------------------------------------------------
// RESIZE_CHILDREN
// ---------------------------------------------------------------------------

describe("RESIZE_CHILDREN", () => {
  it("updates sizes of adjacent children in a SplitNode at root", () => {
    const root = split("v", [leaf(["levelMeter"]), leaf(["loudness"])], [0.5, 0.5]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: { path: [], aboveIdx: 0, aboveSize: 0.7, belowSize: 0.3 },
    });
    expect(next.tree.sizes[0]).toBe(0.7);
    expect(next.tree.sizes[1]).toBe(0.3);
  });

  it("updates sizes in a nested SplitNode", () => {
    const inner = split("h", [leaf(["levelMeter"]), leaf(["loudness"])], [0.4, 0.4]);
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

  it("does not stretch a pinned panel's height when resizing an outer same-direction divider", () => {
    // root(v)[ top(h)[ left(v)[stats, vector], spectrum ], loudness ]
    const leftCol = split("v", [leaf(["stats"]), leaf(["vectorscope"])], [0.54, null]);
    const top = split("h", [leftCol, leaf(["spectrum"])], [0.2, null]);
    const root = split("v", [top, leaf(["loudness"])], [null, null]);
    const s = state(root, { pinnedPanelsById: { stats: { width: 250, height: 150 } } });

    // Drag the root v-divider: the whole top region grows to 600px.
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: {
        path: [],
        aboveIdx: 0,
        belowIdx: 1,
        aboveSize: 0.66,
        belowSize: 0.34,
        direction: "v",
        abovePx: 600,
        belowPx: 300,
      },
    });

    // stats keeps its own row height; it is not rewritten to the region height.
    expect(next.pinnedPanelsById.stats.height).toBe(150);
  });

  it("updates a pinned panel's height when resizing its own enclosing divider", () => {
    const leftCol = split("v", [leaf(["stats"]), leaf(["vectorscope"])], [null, null]);
    const s = state(leftCol, { pinnedPanelsById: { stats: { width: 250, height: 150 } } });

    // Drag the stats|vector divider directly: stats' row height becomes 210px.
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: {
        path: [],
        aboveIdx: 0,
        belowIdx: 1,
        aboveSize: 0.6,
        belowSize: 0.4,
        direction: "v",
        abovePx: 210,
        belowPx: 140,
      },
    });

    expect(next.pinnedPanelsById.stats.height).toBe(210);
  });

  it("does not rewrite a deeply nested pin when resizing an outer same-direction divider", () => {
    // mid: v[ p3, sub: h[ vector*, p4 ] ] — vector's width is owned by sub (inner h-split).
    const sub = split("h", [leaf(["vectorscope"]), leaf(["p4"])], [null, null]);
    const mid = split("v", [leaf(["p3"]), sub], [null, null]);
    const row = split("h", [mid, leaf(["p5"])], [null, null]);
    const s = state(row, { pinnedPanelsById: { vectorscope: { width: 300, height: 200 } } });

    // Drag the row's h-divider (mid | p5): the whole mid region width changes.
    const next = workspaceReducer(s, {
      type: "RESIZE_CHILDREN",
      payload: {
        path: [],
        aboveIdx: 0,
        belowIdx: 1,
        aboveSize: 0.5,
        belowSize: 0.2,
        direction: "h",
        abovePx: 900,
        belowPx: 200,
      },
    });

    // vector keeps its own width; it is not stretched to the region width.
    expect(next.pinnedPanelsById.vectorscope.width).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// SET_ACTIVE_TAB
// ---------------------------------------------------------------------------

describe("SET_ACTIVE_TAB", () => {
  it("sets activeTab on a leaf at a given path", () => {
    const root = split("h", [leaf(["levelMeter", "loudness"], "levelMeter"), leaf(["spectrum"])]);
    const next = workspaceReducer(state(root), {
      type: "SET_ACTIVE_TAB",
      payload: { path: [0], tabId: "loudness" },
    });
    expect(next.tree.children[0].activeTab).toBe("loudness");
  });

  it("does not touch other leaves", () => {
    const right = leaf(["spectrum"]);
    const root = split("h", [leaf(["levelMeter", "loudness"], "levelMeter"), right]);
    const next = workspaceReducer(state(root), {
      type: "SET_ACTIVE_TAB",
      payload: { path: [0], tabId: "loudness" },
    });
    expect(next.tree.children[1]).toBe(right);
  });
});

// ---------------------------------------------------------------------------
// ADD_PANEL / REMOVE_PANEL / RENAME_PANEL
// ---------------------------------------------------------------------------

describe("panel instances", () => {
  it("adds duplicate module instances with distinct ids", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "ADD_PANEL",
      payload: { moduleId: "levelMeter" },
    });

    expect(next.panelsById["levelMeter-2"]).toEqual({ id: "levelMeter-2", moduleId: "levelMeter" });
    expect(next.panelOrder).toContain("levelMeter-2");
    expect(findLeafWithTab(next.tree, "levelMeter-2")).not.toBeNull();
  });

  it("adds a panel as the root when the workspace is empty", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, tree: null, panelsById: {}, panelOrder: [] };
    const next = workspaceReducer(s, { type: "ADD_PANEL", payload: { moduleId: "spectrum" } });

    expect(next.tree).toEqual({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" });
    expect(next.panelsById.spectrum).toEqual({ id: "spectrum", moduleId: "spectrum" });
  });

  it("removes one duplicate without removing its sibling", () => {
    const withDuplicate = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "ADD_PANEL",
      payload: { moduleId: "levelMeter" },
    });
    const next = workspaceReducer(withDuplicate, {
      type: "REMOVE_PANEL",
      payload: { id: "levelMeter-2" },
    });

    expect(next.panelsById.levelMeter).toBeDefined();
    expect(next.panelsById["levelMeter-2"]).toBeUndefined();
    expect(next.panelOrder).not.toContain("levelMeter-2");
    expect(findLeafWithTab(next.tree, "levelMeter")).not.toBeNull();
    expect(findLeafWithTab(next.tree, "levelMeter-2")).toBeNull();
  });

  it("clears fullscreen when removing the fullscreen panel", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: "levelMeter" };
    const next = workspaceReducer(s, { type: "REMOVE_PANEL", payload: { id: "levelMeter" } });
    expect(next.fullscreenId).toBeNull();
  });

  it("cleans up pinned size state when removing a panel", () => {
    const s = {
      ...DEFAULT_WORKSPACE_STATE,
      pinnedPanelsById: {
        levelMeter: { width: 120, height: 400 },
        spectrum: { width: 640, height: 220 },
      },
    };
    const next = workspaceReducer(s, { type: "REMOVE_PANEL", payload: { id: "levelMeter" } });
    expect(next.pinnedPanelsById).toEqual({
      spectrum: { width: 640, height: 220 },
    });
  });

  it("renames and clears custom panel titles", () => {
    const renamed = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "RENAME_PANEL",
      payload: { id: "levelMeter", customTitle: "  Main Meter  " },
    });
    expect(renamed.panelsById.levelMeter.customTitle).toBe("Main Meter");

    const cleared = workspaceReducer(renamed, {
      type: "RENAME_PANEL",
      payload: { id: "levelMeter", customTitle: "   " },
    });
    expect(cleared.panelsById.levelMeter).not.toHaveProperty("customTitle");
  });
});

// ---------------------------------------------------------------------------
// SET_FOCUS
// ---------------------------------------------------------------------------

describe("SET_FOCUS", () => {
  it("activates the target tab in its leaf", () => {
    const root = {
      type: "leaf",
      tabs: ["levelMeter", "loudness"],
      activeTab: "levelMeter",
    };
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "loudness" } });
    expect(next.tree.activeTab).toBe("loudness");
    expect(next).not.toHaveProperty("focusId");
  });

  it("makes focused tab active in its leaf (split tree)", () => {
    const root = split("h", [leaf(["levelMeter", "loudness"], "levelMeter"), leaf(["spectrum"])]);
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "loudness" } });
    expect(next.tree.children[0].activeTab).toBe("loudness");
  });

  it("does not change tree when module is already active", () => {
    const root = leaf(["levelMeter"]);
    const next = workspaceReducer(state(root), {
      type: "SET_FOCUS",
      payload: { id: "levelMeter" },
    });
    expect(next.tree.children?.[0] ?? next.tree).toMatchObject({ activeTab: "levelMeter" });
  });
});

// ---------------------------------------------------------------------------
// SET_FULLSCREEN
// ---------------------------------------------------------------------------

describe("SET_FULLSCREEN", () => {
  it("sets fullscreenId", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_FULLSCREEN",
      payload: "levelMeter",
    });
    expect(next.fullscreenId).toBe("levelMeter");
  });

  it("clears fullscreenId with null", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: "levelMeter" };
    const next = workspaceReducer(s, { type: "SET_FULLSCREEN", payload: null });
    expect(next.fullscreenId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MOVE_TAB
// ---------------------------------------------------------------------------

describe("MOVE_TAB: zone=tabs", () => {
  it("merges source tab into target leaf", () => {
    const root = split("h", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "levelMeter", drop: { targetPath: [1], zone: "tabs", tabIndex: 0 } },
    });
    // left leaf emptied → pruned → root unwraps to right leaf
    expect(next.tree.type).toBe("leaf");
    expect(next.tree.tabs).toContain("levelMeter");
    expect(next.tree.tabs).toContain("loudness");
    expect(next.tree.activeTab).toBe("levelMeter"); // moved tab becomes active
  });
});

describe("MOVE_TAB: zone=below", () => {
  it("places source tab in a new leaf below target", () => {
    const root = split("h", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "levelMeter", drop: { targetPath: [1], zone: "below" } },
    });
    // levelMeter removed from [0] → left leaf empty → root = loudness leaf
    // Then levelMeter inserted below loudness → V[loudness, levelMeter]
    expect(next.tree.direction).toBe("v");
    expect(next.tree.children[0].tabs).toContain("loudness");
    expect(next.tree.children[1].tabs).toContain("levelMeter");
  });

  it("adjusts path when source removal changes tree structure", () => {
    // V[leaf(levelMeter), leaf(loudness)] — drag levelMeter to below loudness (targetPath=[1])
    // After removing levelMeter: root = leaf(loudness) (unwrapped)
    // targetPath [1] is stale; should resolve to insert below root
    const root = split("v", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "levelMeter", drop: { targetPath: [1], zone: "below" } },
    });
    expect(next.tree.direction).toBe("v");
    expect(next.tree.children[0].tabs).toContain("loudness");
    expect(next.tree.children[1].tabs).toContain("levelMeter");
  });
});

describe("MOVE_TAB: zone=right", () => {
  it("places source tab in a new leaf to the right of target", () => {
    const root = split("v", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "loudness", drop: { targetPath: [0], zone: "right" } },
    });
    // loudness removed from [1] → root = leaf(levelMeter); then loudness inserted right of levelMeter
    expect(next.tree.direction).toBe("h");
    expect(next.tree.children[0].tabs).toContain("levelMeter");
    expect(next.tree.children[1].tabs).toContain("loudness");
  });
});

// ---------------------------------------------------------------------------
// MOVE_TAB: drag single-tab leaf back onto itself (stale path crash)
// ---------------------------------------------------------------------------

describe("MOVE_TAB: drag to same single-tab leaf edge (regression)", () => {
  // Bug: dragging the only tab in a leaf back onto that leaf's edge zone
  // causes anchorTab=null → stale fallbackPath → insertLeaf throws on LeafNode

  it("zone=above on same single-tab leaf does not throw and preserves both tabs", () => {
    const root = split("h", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    // sourceId 'levelMeter' is in leaf at [0]; targetPath=[0] is same leaf
    expect(() =>
      workspaceReducer(s, {
        type: "MOVE_TAB",
        payload: { sourceId: "levelMeter", drop: { targetPath: [0], zone: "above" } },
      })
    ).not.toThrow();
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "levelMeter", drop: { targetPath: [0], zone: "above" } },
    });
    expect(next.tree).toBeDefined();
    // Both modules must still be in the tree
    expect(findLeafWithTab(next.tree, "levelMeter")).not.toBeNull();
    expect(findLeafWithTab(next.tree, "loudness")).not.toBeNull();
  });

  it("zone=right on same single-tab leaf does not throw", () => {
    const root = split("v", [leaf(["levelMeter"]), leaf(["loudness"])]);
    const s = state(root);
    expect(() =>
      workspaceReducer(s, {
        type: "MOVE_TAB",
        payload: { sourceId: "levelMeter", drop: { targetPath: [0], zone: "right" } },
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SET_VIEW
// ---------------------------------------------------------------------------

describe("SET_VIEW", () => {
  it("atomically replaces tree, panelsById, panelOrder, and panelControlsById", () => {
    const tree = leaf(["spectrum"]);
    const panelsById = { spectrum: { id: "spectrum", moduleId: "spectrum" } };
    const panelOrder = ["spectrum"];
    const panelControlsById = {
      spectrum: {
        ...DEFAULT_PANEL_CONTROLS,
        vectorscopePair: { x: 2, y: 3 },
        spectrumChannel: { type: "single", ch: 2 },
      },
    };
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: { tree, panelsById, panelOrder, panelControlsById },
    });
    expect(next.tree).toBe(tree);
    expect(next.panelsById).toBe(panelsById);
    expect(next.panelOrder).toBe(panelOrder);
    expectPanelControlsIsolated(next.panelControlsById.spectrum, panelControlsById.spectrum);
  });

  it("restores pinned panel sizes from a view", () => {
    const tree = leaf(["spectrum"]);
    const panelsById = { spectrum: { id: "spectrum", moduleId: "spectrum" } };
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: {
        tree,
        panelsById,
        panelOrder: ["spectrum"],
        panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
        pinnedPanelsById: { spectrum: { width: 640, height: 260 } },
      },
    });

    expect(next.pinnedPanelsById).toEqual({ spectrum: { width: 640, height: 260 } });
  });

  it("normalizes missing pinned panel sizes from older views", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: {
        tree: DEFAULT_WORKSPACE_STATE.tree,
        panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
        panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
        panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
      },
    });

    expect(next.pinnedPanelsById).toEqual({});
  });

  it("clears fullscreenId", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: "levelMeter" };
    const next = workspaceReducer(s, {
      type: "SET_VIEW",
      payload: {
        tree: DEFAULT_WORKSPACE_STATE.tree,
        panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
        panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
        panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
      },
    });
    expect(next.fullscreenId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SET_PANEL_PINNED
// ---------------------------------------------------------------------------

describe("SET_PANEL_PINNED", () => {
  it("stores a panel's pinned pixel size", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_PANEL_PINNED",
      payload: { id: "spectrum", size: { width: 640, height: 260 } },
    });

    expect(next.pinnedPanelsById).toEqual({ spectrum: { width: 640, height: 260 } });
  });

  it("preserves sub-pixel pinned sizes from DOM measurements", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_PANEL_PINNED",
      payload: { id: "spectrum", size: { width: 640.5, height: 260.25 } },
    });

    expect(next.pinnedPanelsById).toEqual({ spectrum: { width: 640.5, height: 260.25 } });
  });

  it("removes a panel's pinned pixel size", () => {
    const stateWithPin = {
      ...DEFAULT_WORKSPACE_STATE,
      pinnedPanelsById: { spectrum: { width: 640, height: 260 } },
    };
    const next = workspaceReducer(stateWithPin, {
      type: "SET_PANEL_PINNED",
      payload: { id: "spectrum", size: null },
    });

    expect(next.pinnedPanelsById).toEqual({});
  });

  it("refreshes split ratios from current layout snapshots when unpinning", () => {
    const tree = split("h", [leaf(["spectrum"]), leaf(["stats"])], [0.5, null]);
    const stateWithPin = state(tree, {
      pinnedPanelsById: { spectrum: { width: 360, height: 260 } },
    });

    const next = workspaceReducer(stateWithPin, {
      type: "SET_PANEL_PINNED",
      payload: {
        id: "spectrum",
        size: null,
        splitSnapshots: [
          {
            path: [],
            childIdx: 0,
            mode: "unpin",
            children: [
              { childIdx: 0, sizePx: 360 },
              { childIdx: 1, sizePx: 540 },
            ],
          },
        ],
      },
    });

    expect(next.pinnedPanelsById).toEqual({});
    expect(next.tree.sizes[0]).toBe(0.4);
    expect(next.tree.sizes[1]).toBe(0.6);
  });

  it("normalizes sibling ratios against remaining space when pinning", () => {
    const tree = split(
      "h",
      [leaf(["levelMeter"]), leaf(["spectrum"]), leaf(["stats"])],
      [0.14, null, 0.18]
    );
    const next = workspaceReducer(state(tree), {
      type: "SET_PANEL_PINNED",
      payload: {
        id: "spectrum",
        size: { width: 680, height: 260 },
        splitSnapshots: [
          {
            path: [],
            childIdx: 1,
            mode: "pin",
            children: [
              { childIdx: 0, sizePx: 140 },
              { childIdx: 1, sizePx: 680 },
              { childIdx: 2, sizePx: 180 },
            ],
          },
        ],
      },
    });

    expect(next.pinnedPanelsById.spectrum).toEqual({ width: 680, height: 260 });
    expect(next.tree.sizes[0]).toBeCloseTo(140 / 320);
    expect(next.tree.sizes[1]).toBeNull();
    expect(next.tree.sizes[2]).toBeCloseTo(180 / 320);
  });
});

// ---------------------------------------------------------------------------
// SET_PANEL_CONTROLS
// ---------------------------------------------------------------------------

describe("SET_PANEL_CONTROLS_FOR_PANEL", () => {
  it("updates one panel's controls", () => {
    const nextControls = {
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      statsVisibleIds: [],
      statsOrder: STATS_CANONICAL_ORDER,
      loudnessHistoryVisibleLayerIds: [],
    };

    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_PANEL_CONTROLS_FOR_PANEL",
      payload: { id: "levelMeter", panelControls: nextControls },
    });

    expectPanelControlsIsolated(next.panelControlsById.levelMeter, nextControls);
    expect(next.panelControlsById.loudness).toEqual(
      DEFAULT_WORKSPACE_STATE.panelControlsById.loudness
    );
  });
});
