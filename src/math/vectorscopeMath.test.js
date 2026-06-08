import { describe, it, expect } from "vitest";
import { buildVectorscopeSvgFromPairs } from "./vectorscopeMath.js";

describe("buildVectorscopeSvgFromPairs", () => {
  it("returns empty string for empty pairs", () => {
    expect(buildVectorscopeSvgFromPairs([])).toBe("");
  });

  it("returns SVG path starting with M for valid pairs", () => {
    const pairs = [0.5, -0.5, 0.3, 0.3, -0.2, 0.1];
    const svg = buildVectorscopeSvgFromPairs(pairs);
    expect(svg).toMatch(/^M /);
    expect(svg).toContain(" L ");
  });

  it("handles odd-length input gracefully (ignores trailing value)", () => {
    const pairs = [0.5, -0.5, 0.3]; // 1 complete pair + 1 leftover
    const svg = buildVectorscopeSvgFromPairs(pairs);
    expect(svg).toMatch(/^M /);
    // Only 1 point → no L segments
    expect(svg).not.toContain(" L ");
  });
});
