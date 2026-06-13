import { describe, expect, it } from "vitest";
import { getSplitChildStyle, getSplitSizingContext } from "./SplitLayout.jsx";

describe("getSplitSizingContext", () => {
  it("normalizes fixed children when all visible split children are fixed", () => {
    expect(getSplitSizingContext([0.14, 0.68, 0.18], 2)).toEqual({
      dividerTotalRem: 0.75,
      fixedTotal: 1,
      normalizeFixed: true,
    });
  });

  it("keeps unnormalized fixed fractions for normal mixed fixed and fluid children", () => {
    expect(getSplitSizingContext([0.14, null, 0.18], 2)).toEqual({
      dividerTotalRem: 0.75,
      fixedTotal: 0.32,
      normalizeFixed: false,
    });
  });

  it("normalizes mixed fixed children when they already fill the container", () => {
    expect(getSplitSizingContext([0.35, 0.35, 0.35, null], 3)).toEqual({
      dividerTotalRem: 1.125,
      fixedTotal: 1.0499999999999998,
      normalizeFixed: true,
    });
  });
});

describe("getSplitChildStyle", () => {
  it("subtracts divider space when all visible split children are fixed", () => {
    const sizing = getSplitSizingContext([0.14, 0.68, 0.18], 2);

    expect(getSplitChildStyle(0.18, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem) * 0.18)",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("normalizes legacy all-fixed totals below one so the split does not leave blank space", () => {
    const sizing = getSplitSizingContext([0.14, 0.66, 0.18], 2);

    expect(getSplitChildStyle(0.18, sizing)).toEqual({
      flex: "0 0 calc((100% - 0.75rem) * 0.183673)",
      minWidth: 0,
      minHeight: 0,
    });
  });

  it("keeps null-sized children fluid in normal mixed splits", () => {
    const sizing = getSplitSizingContext([0.14, null, 0.18], 2);

    expect(getSplitChildStyle(null, sizing)).toEqual({
      flex: "1 1 0",
      minWidth: 0,
      minHeight: 0,
    });
  });
});
