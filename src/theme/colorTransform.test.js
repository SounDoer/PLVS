import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

function dist(a, b) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  return Math.hypot(
    ((pa >> 16) & 255) - ((pb >> 16) & 255),
    ((pa >> 8) & 255) - ((pb >> 8) & 255),
    (pa & 255) - (pb & 255)
  );
}

describe("hexToOklch / oklchToHex round-trip", () => {
  it("round-trips common hexes within 2 rgb units", () => {
    for (const hex of ["#fb923c", "#38bdf8", "#34d399", "#000000", "#ffffff"]) {
      const back = oklchToHex(hexToOklch(hex));
      expect(dist(hex, back)).toBeLessThanOrEqual(2);
    }
  });
});

describe("transform", () => {
  it("applies L/C/H deltas in OKLCH space", () => {
    const base = hexToOklch("#fb923c");
    const lighter = transform(base, { dL: 0.1 });
    expect(lighter.L).toBeGreaterThan(base.L);
    expect(lighter.C).toBeCloseTo(base.C, 5);
    expect(lighter.H).toBeCloseTo(base.H, 5);
  });

  it("clamps L to [0,1] and C to >= 0", () => {
    const base = hexToOklch("#ffffff");
    expect(transform(base, { dL: 1 }).L).toBeLessThanOrEqual(1);
    expect(transform(hexToOklch("#000000"), { dC: -1 }).C).toBeGreaterThanOrEqual(0);
  });
});
