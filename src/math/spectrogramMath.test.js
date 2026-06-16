import { describe, expect, it } from "vitest";
import { hzFromFrac, buildYToBand, spectrogramColumnRanges } from "./spectrogramMath";

describe("hzFromFrac", () => {
  it("frac=0 returns 20 Hz (bottom of log scale → top of canvas)", () => {
    expect(hzFromFrac(0)).toBeCloseTo(20);
  });

  it("frac=1 returns 20 000 Hz", () => {
    expect(hzFromFrac(1)).toBeCloseTo(20000);
  });

  it("frac=0.5 returns the geometric mean of 20 and 20 000 Hz", () => {
    expect(hzFromFrac(0.5)).toBeCloseTo(Math.sqrt(20 * 20000));
  });

  it("is monotonically increasing", () => {
    let prev = hzFromFrac(0);
    for (let i = 1; i <= 10; i++) {
      const next = hzFromFrac(i / 10);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });
});

describe("buildYToBand", () => {
  const bands = [
    { fCenter: 63 },
    { fCenter: 250 },
    { fCenter: 1000 },
    { fCenter: 4000 },
    { fCenter: 16000 },
  ];

  it("returns an Int16Array of length canvasH", () => {
    const result = buildYToBand(bands, 100);
    expect(result).toBeInstanceOf(Int16Array);
    expect(result.length).toBe(100);
  });

  it("all indices are within band array bounds", () => {
    const result = buildYToBand(bands, 200);
    for (let y = 0; y < 200; y++) {
      expect(result[y]).toBeGreaterThanOrEqual(0);
      expect(result[y]).toBeLessThan(bands.length);
    }
  });

  it("top rows (low y) map to high-frequency bands", () => {
    const result = buildYToBand(bands, 100);
    expect(result[0]).toBeGreaterThan(result[99]);
  });
});

describe("spectrogramColumnRanges", () => {
  it("returns empty for no snapshots without throwing", () => {
    const r = spectrogramColumnRanges(0, 0, 100, 300);
    expect(r.bucketCount).toBe(0);
    expect(r.ranges).toEqual([]);
  });

  it("DENSE: scrolling one bucket translates columns by exactly one, nothing dropped", () => {
    const total = 2000;
    const W = 300;
    const vis = 1500; // snapsPerBucket = 5 (integer)
    const spb = vis / W;
    const a = spectrogramColumnRanges(total, 0, vis, W);
    const b = spectrogramColumnRanges(total, spb, vis, W);

    expect(a.bucketCount).toBe(b.bucketCount);

    // Each absolute bucket sits one column to the right after scrolling one bucket.
    for (let x = 5; x < a.bucketCount - 5; x++) {
      expect(b.ranges[x + 1]).toEqual(a.ranges[x]);
    }
    // No empty interior column when downsampled (every pixel covered → no dropped snapshot).
    for (let x = 1; x < a.bucketCount - 1; x++) {
      expect(a.ranges[x][1]).toBeGreaterThan(a.ranges[x][0]);
    }
  });

  it("UPSAMPLED: more pixels than snapshots yields empty columns (painter carries them forward)", () => {
    const total = 50;
    const W = 300;
    const vis = 50; // snapsPerBucket ≈ 0.167
    const r = spectrogramColumnRanges(total, 0, vis, W);
    const nonEmpty = r.ranges.filter(([i0, i1]) => i1 > i0).length;
    expect(nonEmpty).toBeLessThanOrEqual(50);
    expect(nonEmpty).toBeGreaterThan(0);
    expect(r.ranges.some(([i0, i1]) => i1 === i0)).toBe(true);
  });
});
