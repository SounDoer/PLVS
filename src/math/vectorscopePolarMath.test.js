import { describe, expect, it } from "vitest";
import {
  POLAR_LEVEL_BIN_COUNT,
  POLAR_LEVEL_PEAK_HOLD_BUCKET_ROWS,
  aggregatePolarLevel,
  buildPolarLevelPeakHoldTable,
  polarLevelPeakHoldAt,
  polarSampleAlpha,
  projectPairToPolar,
  selectPolarWindow,
  smoothPolarBins,
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

describe("vectorscope polar window", () => {
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

  it("fills valleys without attenuating peaks", () => {
    const bins = new Float64Array([0, 1, 0]);
    // The peak stays at 1 (never cut) while the zero valleys are lifted toward the neighbour average,
    // so a concentrated direction keeps its true height instead of being halved by the kernel.
    expect([...smoothPolarBins(bins)]).toEqual([0.25, 1, 0.25]);
  });

  it("gives each direction its own peak amplitude, independent of other directions", () => {
    const monoOnly = aggregatePolarLevel([{ pairs: new Float32Array([0.5, 0.5]) }]);
    const mixedPairs = [0.5, 0.5];
    for (let index = 0; index < 100; index += 1) mixedPairs.push(0.5, -0.5);
    const mixed = aggregatePolarLevel([{ pairs: new Float32Array(mixedPairs) }]);
    const center = Math.floor(POLAR_LEVEL_BIN_COUNT / 2);

    // The centered sample keeps its own peak amplitude no matter how many side samples pile up
    // elsewhere: per-direction peak, neither averaged down nor density-weighted (Ozone's rays).
    expect(mixed[center]).toBeCloseTo(monoOnly[center]);
  });

  it("takes the loudest sample per direction, not an average", () => {
    const center = Math.floor(POLAR_LEVEL_BIN_COUNT / 2);
    const loudPlusQuiet = aggregatePolarLevel([{ pairs: new Float32Array([1, 1, 0.2, 0.2]) }]);
    const loudAlone = aggregatePolarLevel([{ pairs: new Float32Array([1, 1]) }]);
    // Adding a quiet centered sample must not drag the center bin below the loud one's peak.
    expect(loudPlusQuiet[center]).toBeCloseTo(loudAlone[center]);
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

describe("polar level snapshot peak-hold reconstruction", () => {
  it("does not include a later peak from the selected row's bucket", () => {
    const rows = [{ pairs: new Float32Array([0.1, 0.1]) }, { pairs: new Float32Array([1, 1]) }];
    const built = buildPolarLevelPeakHoldTable(slab(rows));

    expect(Math.max(...polarLevelPeakHoldAt(built, 0))).toBeCloseTo(Math.SQRT2 * 0.1, 5);
    expect(Math.max(...polarLevelPeakHoldAt(built, 1))).toBeCloseTo(Math.SQRT2, 5);
  });

  it("accumulates a bucketed prefix maximum that grows across ~1s buckets", () => {
    const bucket = POLAR_LEVEL_PEAK_HOLD_BUCKET_ROWS;
    // Fill the first bucket with quiet rows and put a loud row at the start of the next bucket.
    const rows = Array.from({ length: bucket + 1 }, (_, i) => ({
      pairs: new Float32Array(i === bucket ? [1, 1] : [0.1, 0.1]),
    }));
    const built = buildPolarLevelPeakHoldTable(slab(rows));
    const first = polarLevelPeakHoldAt(built, 0);
    const lastOfBucket0 = polarLevelPeakHoldAt(built, bucket - 1);
    const loud = polarLevelPeakHoldAt(built, bucket);

    // Within one bucket the hold is constant (the loud row in the next bucket is not reached yet);
    // crossing into the next bucket lifts it, and as a running maximum it never recedes below a peak.
    expect(Math.max(...first)).toBeCloseTo(0.1414, 2);
    expect([...lastOfBucket0]).toEqual([...first]);
    expect(Math.max(...loud)).toBeCloseTo(Math.SQRT2, 5);
    expect(Math.max(...loud)).toBeGreaterThan(Math.max(...first));
  });

  it("does not show a direction before its bucket is reached", () => {
    const bucket = POLAR_LEVEL_PEAK_HOLD_BUCKET_ROWS;
    const rows = Array.from({ length: bucket + 1 }, (_, i) => {
      if (i === 0) return { pairs: new Float32Array([1, 0]) }; // hard-left in bucket 0
      if (i === bucket) return { pairs: new Float32Array([0, 1]) }; // hard-right in bucket 1
      return { pairs: new Float32Array([0, 0]) }; // silence (skipped below the floor)
    });
    const built = buildPolarLevelPeakHoldTable(slab(rows));
    const atLeft = polarLevelPeakHoldAt(built, 0);
    const atBoth = polarLevelPeakHoldAt(built, bucket);
    expect(Math.max(...atLeft.subarray(POLAR_LEVEL_BIN_COUNT / 2 + 1))).toBeCloseTo(0, 5);
    expect(Math.max(...atBoth.subarray(POLAR_LEVEL_BIN_COUNT / 2 + 1))).toBeCloseTo(1, 5);
  });

  it("returns null outside the built range", () => {
    expect(polarLevelPeakHoldAt(buildPolarLevelPeakHoldTable(slab([])), 0)).toBeNull();
    const built = buildPolarLevelPeakHoldTable(slab([{ pairs: new Float32Array([1, 1]) }]));
    expect(polarLevelPeakHoldAt(built, -1)).toBeNull();
    expect(polarLevelPeakHoldAt(built, 1)).toBeNull();
    expect(polarLevelPeakHoldAt(null, 0)).toBeNull();
  });
});
