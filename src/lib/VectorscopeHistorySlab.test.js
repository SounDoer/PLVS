import { describe, expect, it } from "vitest";
import { VectorscopeHistorySlab } from "./VectorscopeHistorySlab.js";

describe("VectorscopeHistorySlab", () => {
  it("stores vectorscope rows as typed views with ring-buffer ordering", () => {
    const slab = new VectorscopeHistorySlab(2, 4);

    slab.push({
      pairs: [0.1, 0.2, 0.3, 0.4],
      correlation: 0.5,
      sideToMidDb: -12,
      midEnergy: 1,
      sideEnergy: 2,
      timestampMs: 1000,
    });
    slab.push({
      pairs: [0.5, 0.6, 0.7, 0.8],
      correlation: 0.6,
      sideToMidDb: -10,
      midEnergy: 3,
      sideEnergy: 4,
      timestampMs: 1040,
    });
    slab.push({
      pairs: [0.9, 1.0, -0.9, -1.0],
      correlation: -0.2,
      sideToMidDb: -8,
      midEnergy: 5,
      sideEnergy: 6,
      timestampMs: 1080,
    });

    expect(slab.length).toBe(2);
    expect(slab.timestampAt(0)).toBe(1040);
    expect(slab.timestampAt(1)).toBe(1080);
    expect(slab.rowAt(0).pairs).toBeInstanceOf(Float32Array);
    expect(Array.from(slab.rowAt(1).pairs)).toEqual(
      expect.arrayContaining([expect.closeTo(0.9), expect.closeTo(1), expect.closeTo(-0.9)])
    );
    expect(slab.rowAt(1).correlation).toBe(-0.2);
  });

  it("freezes rows against later slab overwrites", () => {
    const slab = new VectorscopeHistorySlab(2, 2);

    slab.push({ pairs: [0.1, 0.2], timestampMs: 1000, correlation: 0.1 });
    slab.push({ pairs: [0.3, 0.4], timestampMs: 1040, correlation: 0.2 });
    const frozen = slab.freeze();

    slab.push({ pairs: [0.5, 0.6], timestampMs: 1080, correlation: 0.3 });

    expect(frozen.length).toBe(2);
    expect(frozen.timestampAt(0)).toBe(1000);
    expect(Array.from(frozen.rowAt(0).pairs)).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(frozen.rowAt(1).correlation).toBe(0.2);
  });

  it("clear releases storage and permits later pushes", () => {
    const slab = new VectorscopeHistorySlab(2, 2);

    slab.push({ pairs: [0.1, 0.2], timestampMs: 1000 });
    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.rowAt(0)).toBeUndefined();

    slab.push({ pairs: [0.3, 0.4], timestampMs: 1040 });

    expect(slab.length).toBe(1);
    expect(Array.from(slab.rowAt(0).pairs)).toEqual([expect.closeTo(0.3), expect.closeTo(0.4)]);
  });
});
