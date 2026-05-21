import { describe, it, expect } from "vitest";
import { updateNode, findLeafWithTab, removeTab, insertLeaf, pruneTree } from "./treeUtils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leaf(tabs, activeTab = tabs[0]) {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

function split(direction, children, sizes) {
  return {
    type: "split",
    direction,
    children,
    sizes: sizes ?? children.map(() => 200),
  };
}

// ---------------------------------------------------------------------------
// updateNode
// ---------------------------------------------------------------------------

describe("updateNode", () => {
  it("updates root when path is []", () => {
    const root = leaf(["peak"]);
    const result = updateNode(root, [], (n) => ({ ...n, activeTab: "loudness" }));
    expect(result.activeTab).toBe("loudness");
    expect(root.activeTab).toBe("peak"); // immutable
  });

  it("updates leaf at path [0]", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const result = updateNode(root, [0], (n) => ({ ...n, activeTab: "peak" }));
    expect(result.children[0].activeTab).toBe("peak");
    expect(result.children[1]).toBe(root.children[1]); // sibling reference unchanged
  });

  it("updates leaf at nested path [1, 0]", () => {
    const inner = split("v", [leaf(["spectrum"]), leaf(["spectrogram"])]);
    const root = split("h", [leaf(["peak"]), inner]);
    const result = updateNode(root, [1, 0], (n) => ({ ...n, activeTab: "spectrum" }));
    expect(result.children[1].children[0].activeTab).toBe("spectrum");
    expect(result.children[0]).toBe(root.children[0]);
  });
});

// ---------------------------------------------------------------------------
// findLeafWithTab
// ---------------------------------------------------------------------------

describe("findLeafWithTab", () => {
  it("returns [] when root is a leaf containing the tab", () => {
    expect(findLeafWithTab(leaf(["peak"]), "peak")).toEqual([]);
  });

  it("returns [0] when tab is in first child leaf", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    expect(findLeafWithTab(root, "peak")).toEqual([0]);
  });

  it("returns [1] when tab is in second child leaf", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    expect(findLeafWithTab(root, "loudness")).toEqual([1]);
  });

  it("returns [1, 0] when tab is in nested leaf", () => {
    const inner = split("v", [leaf(["spectrum"]), leaf(["spectrogram"])]);
    const root = split("h", [leaf(["peak"]), inner]);
    expect(findLeafWithTab(root, "spectrum")).toEqual([1, 0]);
  });

  it("returns null when tab is not in tree", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    expect(findLeafWithTab(root, "vectorscope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pruneTree
// ---------------------------------------------------------------------------

describe("pruneTree", () => {
  it("returns null for an empty leaf", () => {
    expect(pruneTree({ type: "leaf", tabs: [], activeTab: null })).toBeNull();
  });

  it("returns valid leaf unchanged", () => {
    const root = leaf(["peak"]);
    expect(pruneTree(root)).toBe(root);
  });

  it("returns null when all leaves are empty", () => {
    const root = split("h", [
      { type: "leaf", tabs: [], activeTab: null },
      { type: "leaf", tabs: [], activeTab: null },
    ]);
    expect(pruneTree(root)).toBeNull();
  });

  it("unwraps single-remaining-child SplitNode to its child", () => {
    const validLeaf = leaf(["loudness"]);
    const root = split("h", [{ type: "leaf", tabs: [], activeTab: null }, validLeaf]);
    const result = pruneTree(root);
    expect(result?.type).toBe("leaf");
    expect(result?.tabs).toEqual(["loudness"]);
  });

  it("preserves SplitNode with two valid children", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const result = pruneTree(root);
    expect(result?.type).toBe("split");
    expect(result?.children).toHaveLength(2);
  });

  it("prunes empty leaf in nested split and unwraps", () => {
    const inner = split("v", [{ type: "leaf", tabs: [], activeTab: null }, leaf(["spectrum"])]);
    const root = split("h", [leaf(["peak"]), inner]);
    const result = pruneTree(root);
    // inner had one empty leaf → pruned → inner unwraps to spectrum leaf
    expect(result?.children[1]?.type).toBe("leaf");
    expect(result?.children[1]?.tabs).toEqual(["spectrum"]);
  });
});

// ---------------------------------------------------------------------------
// removeTab
// ---------------------------------------------------------------------------

describe("removeTab", () => {
  it("returns original tree unchanged if tab not found", () => {
    const root = leaf(["peak"]);
    expect(removeTab(root, "vectorscope")).toBe(root);
  });

  it("removes a tab leaving other tabs in the leaf", () => {
    const root = leaf(["peak", "loudness"], "peak");
    const result = removeTab(root, "loudness");
    expect(result?.tabs).toEqual(["peak"]);
  });

  it("updates activeTab when active tab is removed from multi-tab leaf", () => {
    const root = leaf(["peak", "loudness"], "loudness");
    const result = removeTab(root, "loudness");
    expect(result?.activeTab).toBe("peak");
  });

  it("keeps activeTab unchanged when a non-active tab is removed", () => {
    const root = leaf(["peak", "loudness"], "peak");
    const result = removeTab(root, "loudness");
    expect(result?.activeTab).toBe("peak");
  });

  it("returns null when removing the only tab from a single-leaf tree", () => {
    expect(removeTab(leaf(["peak"]), "peak")).toBeNull();
  });

  it("prunes empty leaf and unwraps single-child split", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const result = removeTab(root, "peak");
    expect(result?.type).toBe("leaf");
    expect(result?.tabs).toEqual(["loudness"]);
  });

  it("preserves siblings when removing tab from a 3-child split", () => {
    const root = split("v", [leaf(["peak"]), leaf(["loudness"]), leaf(["spectrum"])]);
    const result = removeTab(root, "peak");
    expect(result?.type).toBe("split");
    expect(result?.children).toHaveLength(2);
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["spectrum"]);
  });
});

// ---------------------------------------------------------------------------
// insertLeaf — zone='tabs' (merge into existing leaf)
// ---------------------------------------------------------------------------

describe("insertLeaf: zone=tabs", () => {
  it("inserts tab at tabIndex=0 in target leaf", () => {
    const root = split("h", [leaf(["peak"]), leaf(["loudness"])]);
    const result = insertLeaf(root, [1], "tabs", leaf(["spectrum"]), 0);
    expect(result?.children[1].tabs).toEqual(["spectrum", "loudness"]);
    expect(result?.children[1].activeTab).toBe("spectrum");
  });

  it("inserts tab at end of target leaf", () => {
    const root = leaf(["loudness", "peak"], "loudness");
    const result = insertLeaf(root, [], "tabs", leaf(["spectrum"]), 2);
    expect(result?.tabs).toEqual(["loudness", "peak", "spectrum"]);
  });
});

// ---------------------------------------------------------------------------
// insertLeaf — zone='above'/'below' (vertical splits)
// ---------------------------------------------------------------------------

describe("insertLeaf: zone=above/below on root leaf", () => {
  it("zone=above wraps root leaf in V-split, new leaf first", () => {
    const root = leaf(["loudness"]);
    const result = insertLeaf(root, [], "above", leaf(["peak"]));
    expect(result?.type).toBe("split");
    expect(result?.direction).toBe("v");
    expect(result?.children[0].tabs).toEqual(["peak"]);
    expect(result?.children[1].tabs).toEqual(["loudness"]);
  });

  it("zone=below wraps root leaf in V-split, new leaf last", () => {
    const root = leaf(["loudness"]);
    const result = insertLeaf(root, [], "below", leaf(["peak"]));
    expect(result?.direction).toBe("v");
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["peak"]);
  });
});

describe("insertLeaf: zone=above/below promotion in V-split parent", () => {
  it("zone=above inserts sibling before target in existing V-split", () => {
    // V[A, B] → drop above B → V[A, new, B]
    const A = leaf(["loudness"]);
    const B = leaf(["spectrum"]);
    const root = split("v", [A, B]);
    const result = insertLeaf(root, [1], "above", leaf(["peak"]));
    expect(result?.direction).toBe("v");
    expect(result?.children).toHaveLength(3);
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["peak"]);
    expect(result?.children[2].tabs).toEqual(["spectrum"]);
  });

  it("zone=below inserts sibling after target in existing V-split", () => {
    // V[A, B] → drop below A → V[A, new, B]
    const root = split("v", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [0], "below", leaf(["peak"]));
    expect(result?.direction).toBe("v");
    expect(result?.children).toHaveLength(3);
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["peak"]);
    expect(result?.children[2].tabs).toEqual(["spectrum"]);
  });
});

describe("insertLeaf: zone=above/below no promotion in H-split parent", () => {
  it("zone=above on leaf in H-split wraps leaf in V-split", () => {
    // H[A, B] → drop above B → H[A, V[new, B]]
    const root = split("h", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [1], "above", leaf(["peak"]));
    expect(result?.direction).toBe("h");
    expect(result?.children[1].type).toBe("split");
    expect(result?.children[1].direction).toBe("v");
    expect(result?.children[1].children[0].tabs).toEqual(["peak"]);
    expect(result?.children[1].children[1].tabs).toEqual(["spectrum"]);
  });
});

// ---------------------------------------------------------------------------
// insertLeaf — zone='left'/'right' (horizontal splits)
// ---------------------------------------------------------------------------

describe("insertLeaf: zone=left/right on root leaf", () => {
  it("zone=left wraps root leaf in H-split, new leaf first", () => {
    const root = leaf(["loudness"]);
    const result = insertLeaf(root, [], "left", leaf(["peak"]));
    expect(result?.type).toBe("split");
    expect(result?.direction).toBe("h");
    expect(result?.children[0].tabs).toEqual(["peak"]);
    expect(result?.children[1].tabs).toEqual(["loudness"]);
  });

  it("zone=right wraps root leaf in H-split, new leaf last", () => {
    const root = leaf(["loudness"]);
    const result = insertLeaf(root, [], "right", leaf(["peak"]));
    expect(result?.direction).toBe("h");
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["peak"]);
  });
});

describe("insertLeaf: zone=left/right promotion in H-split parent", () => {
  it("zone=right promotes into existing H-split", () => {
    // H[A, B] → drop right of A → H[A, new, B]
    const root = split("h", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [0], "right", leaf(["peak"]));
    expect(result?.direction).toBe("h");
    expect(result?.children).toHaveLength(3);
    expect(result?.children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[1].tabs).toEqual(["peak"]);
    expect(result?.children[2].tabs).toEqual(["spectrum"]);
  });

  it("zone=left promotes into existing H-split", () => {
    // H[A, B] → drop left of B → H[A, new, B]
    const root = split("h", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [1], "left", leaf(["peak"]));
    expect(result?.direction).toBe("h");
    expect(result?.children).toHaveLength(3);
    expect(result?.children[1].tabs).toEqual(["peak"]);
  });
});

describe("insertLeaf: zone=right no promotion in V-split parent", () => {
  it("zone=right on leaf in V-split wraps leaf in H-split", () => {
    // V[A, B] → drop right of A → V[H[A, new], B]
    const root = split("v", [leaf(["loudness"]), leaf(["spectrum"])]);
    const result = insertLeaf(root, [0], "right", leaf(["peak"]));
    expect(result?.direction).toBe("v");
    expect(result?.children[0].type).toBe("split");
    expect(result?.children[0].direction).toBe("h");
    expect(result?.children[0].children[0].tabs).toEqual(["loudness"]);
    expect(result?.children[0].children[1].tabs).toEqual(["peak"]);
  });
});

// ---------------------------------------------------------------------------
// insertLeaf — sizes must be 0 (flex-fill) not fixed px
// ---------------------------------------------------------------------------

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
