import { describe, expect, test } from "vitest";
import { buildVectorscopePairOptions, formatVectorscopePairLabel } from "./vectorscopePairMath.js";

describe("buildVectorscopePairOptions", () => {
  test("returns empty for <2 channels", () => {
    expect(buildVectorscopePairOptions(0)).toEqual([]);
    expect(buildVectorscopePairOptions(1)).toEqual([]);
  });

  test("builds unique x<y pairs with peak-style labels", () => {
    const opts = buildVectorscopePairOptions(4);
    expect(opts.map((o) => o.key)).toEqual(["0-1", "0-2", "0-3", "1-2", "1-3", "2-3"]);
    expect(opts[0].label).toBe("L/R");
    expect(opts.at(-1)?.label).toBe("Ls/Rs");
  });

  test("uses 5.1 strip names for six channels", () => {
    const opts = buildVectorscopePairOptions(6);
    expect(opts.find((o) => o.key === "0-1")?.label).toBe("L/R");
    expect(opts.find((o) => o.key === "4-5")?.label).toBe("Ls/Rs");
  });
});

describe("formatVectorscopePairLabel", () => {
  test("formats with channelLabels when supplied", () => {
    expect(formatVectorscopePairLabel({ x: 0, y: 1, channelLabels: ["L", "R"] })).toBe("L/R");
    expect(formatVectorscopePairLabel({ x: 2, y: 5, channelLabels: ["L", "R", "C", "LFE", "Ls", "Rs"] })).toBe("C/Rs");
  });

  test("falls back to Ch numbering without labels array", () => {
    expect(formatVectorscopePairLabel({ x: 0, y: 1, channelLabels: [] })).toBe("Ch 1/Ch 2");
    expect(formatVectorscopePairLabel({ x: 2, y: 5 })).toBe("Ch 3/Ch 6");
  });
});
