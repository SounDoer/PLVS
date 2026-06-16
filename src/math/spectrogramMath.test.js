import { describe, expect, it } from "vitest";
import { hzFromFrac, buildYToBand } from "./spectrogramMath";

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
