import { describe, expect, test } from "vitest";
import { buildVectorscopePairOptions, formatVectorscopePairLabel } from "./vectorscopePairMath.js";

describe("buildVectorscopePairOptions", () => {
  test("returns empty for <2 channels", () => {
    expect(buildVectorscopePairOptions(0)).toEqual([]);
    expect(buildVectorscopePairOptions(1)).toEqual([]);
  });

  test("builds unique x<y pairs", () => {
    const opts = buildVectorscopePairOptions(4);
    expect(opts.map((o) => o.key)).toEqual(["0-1", "0-2", "0-3", "1-2", "1-3", "2-3"]);
    expect(opts[0].label).toBe("Ch 1/Ch 2");
    expect(opts.at(-1)?.label).toBe("Ch 3/Ch 4");
  });
});

describe("formatVectorscopePairLabel", () => {
  test("uses FL/FR only for known layout (0,1)", () => {
    expect(formatVectorscopePairLabel({ x: 0, y: 1, layoutKnown: true })).toBe("FL/FR");
    expect(formatVectorscopePairLabel({ x: 0, y: 1, layoutKnown: false })).toBe("Ch 1/Ch 2");
  });

  test("falls back to channel numbering", () => {
    expect(formatVectorscopePairLabel({ x: 2, y: 5, layoutKnown: true })).toBe("Ch 3/Ch 6");
  });
});

