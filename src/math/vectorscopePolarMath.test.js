import { describe, expect, it } from "vitest";
import {
  POLAR_LEVEL_BIN_COUNT,
  aggregatePolarLevel,
  polarSampleAlpha,
  polarWindowExtent,
  projectPairToPolar,
  selectPolarWindow,
  smoothPolarBins,
  updatePolarExtent,
  updatePolarLevelEnvelope,
  updatePolarPeakHold,
} from "./vectorscopePolarMath.js";

function slab(rows) {
  return {
    length: rows.length,
    timestampAt: (index) => rows[index].timestampMs,
    rowAt: (index) => rows[index],
  };
}

describe("vectorscope polar projection", () => {
  it("folds positive and negative centered mono to the top", () => {
    for (const sample of [1, -1]) {
      const point = projectPairToPolar(sample, sample);
      expect(point.x).toBeCloseTo(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.angle).toBeCloseTo(0);
    }
  });

  it("maps left/right symmetrically and opposite polarity to the ends", () => {
    expect(projectPairToPolar(1, 0).angle).toBeCloseTo(-Math.PI / 4);
    expect(projectPairToPolar(0, 1).angle).toBeCloseTo(Math.PI / 4);
    expect(Math.abs(projectPairToPolar(1, -1).angle)).toBeCloseTo(Math.PI / 2);
  });

  it("clamps samples and angles", () => {
    const point = projectPairToPolar(4, -3);
    expect(point.radius).toBeCloseTo(Math.sqrt(2));
    expect(point.angle).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(point.angle).toBeLessThanOrEqual(Math.PI / 2);
  });
});

describe("vectorscope polar window and extent", () => {
  it("selects 400 ms relative to the newest row without copying pairs", () => {
    const oldPairs = new Float32Array([0, 0]);
    const edgePairs = new Float32Array([0.5, 0.5]);
    const newestPairs = new Float32Array([1, 1]);
    const rows = selectPolarWindow(
      slab([
        { timestampMs: 599, pairs: oldPairs },
        { timestampMs: 600, pairs: edgePairs },
        { timestampMs: 1000, pairs: newestPairs },
      ])
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].pairs).toBe(edgePairs);
    expect(rows.map((row) => row.ageMs)).toEqual([400, 0]);
  });

  it("maps sample age to fading opacity", () => {
    expect(polarSampleAlpha(0)).toBeCloseTo(0.9);
    expect(polarSampleAlpha(200)).toBeCloseTo(0.45);
    expect(polarSampleAlpha(400)).toBe(0);
    expect(polarSampleAlpha(800)).toBe(0);
  });

  it("computes the largest folded radius", () => {
    expect(polarWindowExtent([{ pairs: new Float32Array([0.25, 0.25, 1, -1]) }])).toBeCloseTo(
      Math.sqrt(2)
    );
  });

  it("shrinks immediately, expands slowly, and freezes on silence", () => {
    expect(updatePolarExtent(0.5, 1, 16, true)).toBe(1);
    const released = updatePolarExtent(1, 0.5, 100, true);
    expect(released).toBeGreaterThan(0.5);
    expect(released).toBeLessThan(1);
    expect(updatePolarExtent(released, 0.02, 100, false)).toBe(released);
  });

  it("is time-based across frame cadences", () => {
    const once = updatePolarExtent(1, 0.2, 100, true);
    const twice = updatePolarExtent(updatePolarExtent(1, 0.2, 50, true), 0.2, 50, true);
    expect(twice).toBeCloseTo(once, 10);
  });
});

describe("Polar Level", () => {
  it("places mono at center and mirrors left/right", () => {
    const mono = aggregatePolarLevel([{ pairs: new Float32Array([1, 1]) }]);
    const center = Math.floor(POLAR_LEVEL_BIN_COUNT / 2);
    expect(mono[center] + mono[center - 1]).toBeGreaterThan(0);

    const left = aggregatePolarLevel([{ pairs: new Float32Array([1, 0]) }]);
    const right = aggregatePolarLevel([{ pairs: new Float32Array([0, 1]) }]);
    for (let index = 0; index < left.length; index += 1) {
      expect(left[index]).toBeCloseTo(right[right.length - 1 - index]);
    }
  });

  it("smooths neighboring bins symmetrically", () => {
    const bins = new Float64Array([0, 1, 0]);
    expect([...smoothPolarBins(bins)]).toEqual([0.25, 0.5, 0.25]);
  });

  it("keeps a bin's level independent of samples in other directions", () => {
    const monoOnly = aggregatePolarLevel([{ pairs: new Float32Array([0.5, 0.5]) }]);
    const mixedPairs = [0.5, 0.5];
    for (let index = 0; index < 100; index += 1) mixedPairs.push(0.5, -0.5);
    const mixed = aggregatePolarLevel([{ pairs: new Float32Array(mixedPairs) }]);
    const center = Math.floor(POLAR_LEVEL_BIN_COUNT / 2);

    expect(mixed[center]).toBeCloseTo(monoOnly[center], 10);
  });

  it("uses fast attack and slower release", () => {
    const zero = new Float64Array([0]);
    const one = new Float64Array([1]);
    const attacked = updatePolarLevelEnvelope(zero, one, 100);
    const released = updatePolarLevelEnvelope(one, zero, 100);
    expect(attacked[0]).toBeGreaterThan(1 - released[0]);
    expect(updatePolarLevelEnvelope(zero, one, 100, { settled: true })[0]).toBe(1);
  });

  it("holds per-bin peaks until reset or disabled", () => {
    const first = updatePolarPeakHold(null, new Float64Array([0.2, 0.8]), { enabled: true });
    const second = updatePolarPeakHold(first, new Float64Array([0.7, 0.3]), { enabled: true });
    expect([...second]).toEqual([0.7, 0.8]);
    expect(
      updatePolarPeakHold(second, new Float64Array([0.1, 0.1]), { enabled: false })
    ).toBeNull();
    expect([
      ...updatePolarPeakHold(second, new Float64Array([0.1, 0.1]), {
        enabled: true,
        reset: true,
      }),
    ]).toEqual([0.1, 0.1]);
  });
});
