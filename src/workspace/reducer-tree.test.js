/**
 * Tests for the tree-based workspace reducer (replaces dock-based reducer.test.js).
 */
import { describe, it, expect } from "vitest";
import { workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { findLeafWithTab } from "./treeUtils.js";
import { DEFAULT_PANEL_CONTROLS, LOUDNESS_STATS_ORDER } from "../lib/panelControls.js";

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
  expect(actual).toEqual(source);
  expect(actual).not.toBe(source);
  expect(actual.vectorscopePair).not.toBe(source.vectorscopePair);
  expect(actual.spectrumChannel).not.toBe(source.spectrumChannel);
  expect(actual.loudnessStatsVisibleIds).not.toBe(source.loudnessStatsVisibleIds);
  expect(actual.loudnessHistoryVisibleLayerIds).not.toBe(source.loudnessHistoryVisibleLayerIds);
}

// ---------------------------------------------------------------------------
// SET_TREE
// ---------------------------------------------------------------------------

describe("SET_TREE", () => {
  it("replaces the entire tree", () => {
    const newTree = leaf(["peak"]);
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

// ---------------------------------------------------------------------------
// SET_ACTIVE_TAB
// ---------------------------------------------------------------------------

describe("SET_ACTIVE_TAB", () => {
  it("sets activeTab on a leaf at a given path", () => {
    const root = split("h", [leaf(["peak", "loudness"], "peak"), leaf(["spectrum"])]);
    const next = workspaceReducer(state(root), {
      type: "SET_ACTIVE_TAB",
      payload: { path: [0], tabId: "loudness" },
    });
    expect(next.tree.children[0].activeTab).toBe("loudness");
  });

  it("does not touch other leaves", () => {
    const right = leaf(["spectrum"]);
    const root = split("h", [leaf(["peak", "loudness"], "peak"), right]);
    const next = workspaceReducer(state(root), {
      type: "SET_ACTIVE_TAB",
      payload: { path: [0], tabId: "loudness" },
    });
    expect(next.tree.children[1]).toBe(right);
  });
});

// ---------------------------------------------------------------------------
// TOGGLE_MODULE_VISIBLE
// ---------------------------------------------------------------------------

describe("TOGGLE_MODULE_VISIBLE", () => {
  it("removes module from visibleModules when hiding", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE };
    const next = workspaceReducer(s, { type: "TOGGLE_MODULE_VISIBLE", payload: { id: "peak" } });
    expect(next.visibleModules).not.toContain("peak");
  });

  it("adds module to visibleModules when showing", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, visibleModules: ["loudness"] };
    const next = workspaceReducer(s, { type: "TOGGLE_MODULE_VISIBLE", payload: { id: "peak" } });
    expect(next.visibleModules).toContain("peak");
  });

  it("does NOT change tree structure when toggling visibility", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE };
    const next = workspaceReducer(s, { type: "TOGGLE_MODULE_VISIBLE", payload: { id: "peak" } });
    expect(next.tree).toBe(s.tree);
  });
});

// ---------------------------------------------------------------------------
// SET_FOCUS
// ---------------------------------------------------------------------------

describe("SET_FOCUS", () => {
  it("activates the target tab in its leaf", () => {
    const root = {
      type: "leaf",
      tabs: ["peak", "loudness"],
      activeTab: "peak",
    };
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "loudness" } });
    expect(next.tree.activeTab).toBe("loudness");
    expect(next).not.toHaveProperty("focusId");
  });

  it("makes focused tab active in its leaf (split tree)", () => {
    const root = split("h", [leaf(["peak", "loudness"], "peak"), leaf(["spectrum"])]);
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "loudness" } });
    expect(next.tree.children[0].activeTab).toBe("loudness");
  });

  it("does not change tree when module is already active", () => {
    const root = leaf(["peak"]);
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "peak" } });
    expect(next.tree.children?.[0] ?? next.tree).toMatchObject({ activeTab: "peak" });
  });
});

// ---------------------------------------------------------------------------
// SET_FULLSCREEN
// ---------------------------------------------------------------------------

describe("SET_FULLSCREEN", () => {
  it("sets fullscreenId", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_FULLSCREEN",
      payload: "peak",
    });
    expect(next.fullscreenId).toBe("peak");
  });

  it("clears fullscreenId with null", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: "peak" };
    const next = workspaceReducer(s, { type: "SET_FULLSCREEN", payload: null });
    expect(next.fullscreenId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MOVE_TAB
// ---------------------------------------------------------------------------

describe("MOVE_TAB: zone=tabs", () => {
  it("merges source tab into target leaf", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "peak", drop: { targetPath: [1], zone: "tabs", tabIndex: 0 } },
    });
    // left leaf emptied → pruned → root unwraps to right leaf
    expect(next.tree.type).toBe("leaf");
    expect(next.tree.tabs).toContain("peak");
    expect(next.tree.tabs).toContain("loudness");
    expect(next.tree.activeTab).toBe("peak"); // moved tab becomes active
  });
});

describe("MOVE_TAB: zone=below", () => {
  it("places source tab in a new leaf below target", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "peak", drop: { targetPath: [1], zone: "below" } },
    });
    // peak removed from [0] → left leaf empty → root = loudness leaf
    // Then peak inserted below loudness → V[loudness, peak]
    expect(next.tree.direction).toBe("v");
    expect(next.tree.children[0].tabs).toContain("loudness");
    expect(next.tree.children[1].tabs).toContain("peak");
  });

  it("adjusts path when source removal changes tree structure", () => {
    // V[leaf(peak), leaf(loudness)] — drag peak to below loudness (targetPath=[1])
    // After removing peak: root = leaf(loudness) (unwrapped)
    // targetPath [1] is stale; should resolve to insert below root
    const root = split("v", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "peak", drop: { targetPath: [1], zone: "below" } },
    });
    expect(next.tree.direction).toBe("v");
    expect(next.tree.children[0].tabs).toContain("loudness");
    expect(next.tree.children[1].tabs).toContain("peak");
  });
});

describe("MOVE_TAB: zone=right", () => {
  it("places source tab in a new leaf to the right of target", () => {
    const root = split("v", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "loudness", drop: { targetPath: [0], zone: "right" } },
    });
    // loudness removed from [1] → root = leaf(peak); then loudness inserted right of peak
    expect(next.tree.direction).toBe("h");
    expect(next.tree.children[0].tabs).toContain("peak");
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
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    // sourceId 'peak' is in leaf at [0]; targetPath=[0] is same leaf
    expect(() =>
      workspaceReducer(s, {
        type: "MOVE_TAB",
        payload: { sourceId: "peak", drop: { targetPath: [0], zone: "above" } },
      })
    ).not.toThrow();
    const next = workspaceReducer(s, {
      type: "MOVE_TAB",
      payload: { sourceId: "peak", drop: { targetPath: [0], zone: "above" } },
    });
    expect(next.tree).toBeDefined();
    // Both modules must still be in the tree
    expect(findLeafWithTab(next.tree, "peak")).not.toBeNull();
    expect(findLeafWithTab(next.tree, "loudness")).not.toBeNull();
  });

  it("zone=right on same single-tab leaf does not throw", () => {
    const root = split("v", [leaf(["peak"]), leaf(["loudness"])]);
    const s = state(root, { visibleModules: ["peak", "loudness"] });
    expect(() =>
      workspaceReducer(s, {
        type: "MOVE_TAB",
        payload: { sourceId: "peak", drop: { targetPath: [0], zone: "right" } },
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SET_VIEW
// ---------------------------------------------------------------------------

describe("SET_VIEW", () => {
  it("atomically replaces tree, visibleModules, and panelControls", () => {
    const tree = leaf(["spectrum"]);
    const panelControls = {
      ...DEFAULT_PANEL_CONTROLS,
      vectorscopePair: { x: 2, y: 3 },
      spectrumChannel: { type: "single", ch: 2 },
    };
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: { tree, visibleModules: ["spectrum"], panelControls },
    });
    expect(next.tree).toBe(tree);
    expect(next.visibleModules).toEqual(["spectrum"]);
    expectPanelControlsIsolated(next.panelControls, panelControls);
  });

  it("clears fullscreenId", () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: "peak" };
    const next = workspaceReducer(s, {
      type: "SET_VIEW",
      payload: {
        tree: DEFAULT_WORKSPACE_STATE.tree,
        visibleModules: DEFAULT_WORKSPACE_STATE.visibleModules,
        panelControls: DEFAULT_WORKSPACE_STATE.panelControls,
      },
    });
    expect(next.fullscreenId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SET_PANEL_CONTROLS
// ---------------------------------------------------------------------------

describe("SET_PANEL_CONTROLS", () => {
  it("updates panelControls", () => {
    const nextControls = {
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      loudnessStatsVisibleIds: [],
      loudnessStatsOrder: LOUDNESS_STATS_ORDER,
      loudnessHistoryVisibleLayerIds: [],
    };

    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_PANEL_CONTROLS",
      payload: { panelControls: nextControls },
    });

    expectPanelControlsIsolated(next.panelControls, nextControls);
  });
});
