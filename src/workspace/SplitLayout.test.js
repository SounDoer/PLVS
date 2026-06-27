import { describe, expect, it } from "vitest";
import { getPinnedSizeForNode, getSplitChildStyle, getSplitSizingContext } from "./SplitLayout.jsx";

describe("getSplitSizingContext", () => {
  it("normalizes fixed children when all visible split children are fixed", () => {
    expect(getSplitSizingContext([0.14, 0.68, 0.18], 2)).toEqual({
      dividerTotalRem: 0.75,
      fixedTotal: 1,
      normalizeFixed: true,
      pinnedTotalPx: 0,
    });
  });

  it("keeps unnormalized fixed fractions for normal mixed fixed and fluid children", () => {
    expect(getSplitSizingContext([0.14, null, 0.18], 2)).toEqual({
      dividerTotalRem: 0.75,
      fixedTotal: 0.32,
      normalizeFixed: false,
      pinnedTotalPx: 0,
    });
  });

  it("normalizes mixed fixed children when they already fill the container", () => {
    expect(getSplitSizingContext([0.35, 0.35, 0.35, null], 3)).toEqual({
      dividerTotalRem: 1.125,
      fixedTotal: 1.0499999999999998,
      normalizeFixed: true,
      pinnedTotalPx: 0,
    });
  });

  it("tracks pinned pixel space separately from ratio sizes", () => {
    expect(getSplitSizingContext([0.14, null, 0.18], 2, [220, null, 0])).toEqual({
      dividerTotalRem: 0.75,
      fixedTotal: 0.18,
      normalizeFixed: false,
      pinnedTotalPx: 220,
    });
  });
});

describe("getSplitChildStyle", () => {
  it("subtracts divider space when all visible split children are fixed", () => {
    const sizing = getSplitSizingContext([0.14, 0.68, 0.18], 2);

    expect(getSplitChildStyle(0.18, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem) * 0.18)",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("normalizes legacy all-fixed totals below one so the split does not leave blank space", () => {
    const sizing = getSplitSizingContext([0.14, 0.66, 0.18], 2);

    expect(getSplitChildStyle(0.18, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem) * 0.183673)",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("keeps null-sized children fluid in normal mixed splits", () => {
    const sizing = getSplitSizingContext([0.14, null, 0.18], 2);

    expect(getSplitChildStyle(null, sizing)).toEqual({
      flex: "1 1 0",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("uses a pinned pixel flex basis when a split child is locked", () => {
    const sizing = getSplitSizingContext([0.14, null, 0.18], 2, [220, null, 0]);

    expect(getSplitChildStyle(0.14, sizing, 220)).toEqual({
      flex: "0 0 220px",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("preserves sub-pixel pinned flex bases to avoid a visual nudge on pin", () => {
    const sizing = getSplitSizingContext([0.14, null, 0.18], 2, [219.5, null, 0]);

    expect(getSplitChildStyle(0.14, sizing, 219.5)).toEqual({
      flex: "0 0 219.5px",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("subtracts pinned pixel space from ratio-sized siblings", () => {
    const sizing = getSplitSizingContext([0.14, null, 0.18], 2, [220, null, 0]);

    expect(getSplitChildStyle(0.18, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem - 220px) * 0.18)",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("can preserve a sibling's current pixels by normalizing its ratio to remaining space", () => {
    const sizing = getSplitSizingContext([0.5, null, 0.5], 2, [674, null, 0]);

    expect(getSplitChildStyle(0.5, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem - 674px) * 0.5)",
      minWidth: 0,
      minHeight: 0,
    });
  });
});

describe("getPinnedSizeForNode (directional scoping)", () => {
  // root(v)[ top(h)[ left(v)[stats, vector], spectrum, levelMeter ], loudness ]
  const tree = {
    type: "split",
    direction: "v",
    sizes: [null, null],
    children: [
      {
        type: "split",
        direction: "h",
        sizes: [0.2, null, 0.18],
        children: [
          {
            type: "split",
            direction: "v",
            sizes: [0.54, null],
            children: [
              { type: "leaf", tabs: ["stats"], activeTab: "stats" },
              { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
            ],
          },
          { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
        ],
      },
      { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
    ],
  };
  const state = { tree, pinnedPanelsById: { stats: { width: 250, height: 150 } } };
  const topRegion = tree.children[0];
  const leftCol = topRegion.children[0];
  const statsLeaf = leftCol.children[0];

  it("does not bleed a pinned height past the nearest enclosing v-split", () => {
    // The root v-split must not lock the whole top region to stats' height,
    // which would collapse vectorscope.
    expect(getPinnedSizeForNode(topRegion, state, "v")).toBe(null);
  });

  it("locks the column width at the nearest enclosing h-split", () => {
    expect(getPinnedSizeForNode(leftCol, state, "h")).toBe(250);
  });

  it("locks the panel height at its own leaf within the nearest v-split", () => {
    expect(getPinnedSizeForNode(statsLeaf, state, "v")).toBe(150);
  });
});

describe("getPinnedSizeForNode (deep mixed nesting, multiple pins)", () => {
  const lf = (id) => ({ type: "leaf", tabs: [id], activeTab: id });
  const sp = (direction, children) => ({
    type: "split",
    direction,
    children,
    sizes: children.map(() => null),
  });

  // root(v)[ row1: h[ colA: v[stats*, p2], mid: v[p3, sub: h[vector*, p4]], p5 ],
  //          row2: h[p6, p7] ]
  // stats*  {w250,h150}: width owned by row1(h), height owned by colA(v)
  // vector* {w300,h200}: width owned by sub(h),  height owned by mid(v)
  const colA = sp("v", [lf("stats"), lf("p2")]);
  const sub = sp("h", [lf("vectorscope"), lf("p4")]);
  const mid = sp("v", [lf("p3"), sub]);
  const row1 = sp("h", [colA, mid, lf("p5")]);
  const root = sp("v", [row1, sp("h", [lf("p6"), lf("p7")])]);
  const state = {
    tree: root,
    pinnedPanelsById: {
      stats: { width: 250, height: 150 },
      vectorscope: { width: 300, height: 200 },
    },
  };

  it("root never inherits a nested pinned height", () => {
    expect(getPinnedSizeForNode(row1, state, "v")).toBe(null);
  });

  it("a pinned width stops at its nearest h-split and does not bleed to outer h-splits", () => {
    expect(getPinnedSizeForNode(colA, state, "h")).toBe(250); // row1 locks colA
    expect(getPinnedSizeForNode(mid, state, "h")).toBe(null); // vector width owned by sub
    expect(getPinnedSizeForNode(sub.children[0], state, "h")).toBe(300); // sub locks vector
  });

  it("a pinned height stops at its nearest v-split and does not bleed to outer v-splits", () => {
    expect(getPinnedSizeForNode(colA.children[0], state, "v")).toBe(150); // colA locks stats
    expect(getPinnedSizeForNode(sub, state, "v")).toBe(200); // mid locks sub
  });
});
