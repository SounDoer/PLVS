import { describe, expect, it } from "vitest";
import {
  PERSISTENCE_ALPHA_MAX,
  PERSISTENCE_ALPHA_MIN,
  selectPersistenceWindow,
  computeWindowEffRadius,
  persistenceAlpha,
  drawPersistenceWindow,
} from "./vectorscopePersistence.js";

function fakeSlab(rows) {
  return {
    length: rows.length,
    timestampAt: (i) => rows[i]?.timestampMs ?? NaN,
    rowAt: (i) => rows[i],
  };
}

describe("selectPersistenceWindow", () => {
  it("returns rows within the window, oldest first, aged against the newest row", () => {
    const slab = fakeSlab([
      { pairs: [0.1, 0.1], timestampMs: 1000 },
      { pairs: [0.2, 0.2], timestampMs: 2600 },
      { pairs: [0.3, 0.3], timestampMs: 3000 },
      { pairs: [0.4, 0.4], timestampMs: 4000 },
    ]);
    const rows = selectPersistenceWindow(slab, 1500);
    expect(rows.map((r) => r.ageMs)).toEqual([1400, 1000, 0]);
    expect(rows.map((r) => r.pairs[0])).toEqual([0.2, 0.3, 0.4]);
  });

  it("returns an empty list for missing, empty, or single-row slabs", () => {
    expect(selectPersistenceWindow(null, 1500)).toEqual([]);
    expect(selectPersistenceWindow(fakeSlab([]), 1500)).toEqual([]);
    expect(selectPersistenceWindow(fakeSlab([{ pairs: [0, 0], timestampMs: 1 }]), 1500)).toEqual(
      []
    );
  });

  it("returns an empty list when only one row falls inside the window", () => {
    const slab = fakeSlab([
      { pairs: [0.1, 0.1], timestampMs: 0 },
      { pairs: [0.2, 0.2], timestampMs: 10000 },
    ]);
    expect(selectPersistenceWindow(slab, 1500)).toEqual([]);
  });
});

describe("computeWindowEffRadius", () => {
  it("applies the extent floor for silent windows", () => {
    // All-zero pairs: extent floors at 0.02, radius caps at the base plot radius (122).
    expect(computeWindowEffRadius([{ pairs: [0, 0, 0, 0], ageMs: 0 }])).toBe(122);
  });

  it("computes one shared radius across all rows", () => {
    // l = r = 1 -> mid = sqrt(2) -> extent sqrt(2) -> radius 122 / sqrt(2).
    const rows = [
      { pairs: [0, 0], ageMs: 100 },
      { pairs: [1, 1], ageMs: 0 },
    ];
    expect(computeWindowEffRadius(rows)).toBeCloseTo(122 / Math.SQRT2, 6);
  });
});

describe("persistenceAlpha", () => {
  it("maps age 0 to the max alpha and window edge to the min alpha", () => {
    expect(persistenceAlpha(0, 1500)).toBeCloseTo(PERSISTENCE_ALPHA_MAX, 9);
    expect(persistenceAlpha(1500, 1500)).toBeCloseTo(PERSISTENCE_ALPHA_MIN, 9);
    expect(persistenceAlpha(3000, 1500)).toBeCloseTo(PERSISTENCE_ALPHA_MIN, 9);
    expect(persistenceAlpha(750, 1500)).toBeCloseTo(
      (PERSISTENCE_ALPHA_MAX + PERSISTENCE_ALPHA_MIN) / 2,
      6
    );
  });
});

describe("drawPersistenceWindow", () => {
  function stubCtx() {
    const calls = [];
    return {
      calls,
      set globalAlpha(v) {
        calls.push(["globalAlpha", v]);
      },
      beginPath: () => calls.push(["beginPath"]),
      moveTo: (x, y) => calls.push(["moveTo", x, y]),
      lineTo: (x, y) => calls.push(["lineTo", x, y]),
      stroke: () => calls.push(["stroke"]),
      clearRect: (...a) => calls.push(["clearRect", ...a]),
    };
  }

  it("draws one faded polyline per row scaled to the canvas size", () => {
    const ctx = stubCtx();
    // Center pair (0,0) projects to plot center 130,130 in the 260 coordinate space;
    // canvas 520x520 doubles it.
    drawPersistenceWindow(
      ctx,
      [
        { pairs: [0, 0, 0, 0], ageMs: 1500 },
        { pairs: [0, 0], ageMs: 0 },
      ],
      { width: 520, height: 520, windowMs: 1500 }
    );
    const alphaValues = ctx.calls.filter((c) => c[0] === "globalAlpha").map((c) => c[1]);
    expect(alphaValues).toHaveLength(2);
    expect(alphaValues[0]).toBeCloseTo(PERSISTENCE_ALPHA_MIN, 9);
    expect(alphaValues[1]).toBeCloseTo(PERSISTENCE_ALPHA_MAX, 9);
    expect(ctx.calls.map((c) => (c[0] === "globalAlpha" ? ["globalAlpha"] : c))).toEqual([
      ["clearRect", 0, 0, 520, 520],
      ["globalAlpha"],
      ["beginPath"],
      ["moveTo", 260, 260],
      ["lineTo", 260, 260],
      ["stroke"],
      ["globalAlpha"],
      ["beginPath"],
      ["moveTo", 260, 260],
      ["stroke"],
    ]);
  });
});
