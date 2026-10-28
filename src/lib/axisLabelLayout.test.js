import { describe, expect, it } from "vitest";
import { axisTickPosition, layoutAxisLabels, minimumAxisLabelExtent } from "./axisLabelLayout.js";

function labels(values, sizes = values.map(() => 12)) {
  return values.map((frac, index) => ({
    key: index,
    frac,
    position: axisTickPosition(index, frac, values.length),
    size: sizes[index],
  }));
}

describe("axis label layout", () => {
  it("uses pinned text boxes rather than distance between tick values", () => {
    const ticks = labels([0, 3 / 63, 1]);
    expect([...layoutAxisLabels(ticks, 126).hidden]).toEqual([1]);
    expect([...layoutAxisLabels(ticks, 126, { referenceKey: 1 }).hidden]).toEqual([0]);
    expect([...layoutAxisLabels(ticks, 630, { referenceKey: 1 }).hidden]).toEqual([]);
  });
  it("applies the reference policy in either direction without moving anchors", () => {
    const ticks = labels([1, 1 - 3 / 63, 0]);
    const before = structuredClone(ticks);
    expect([...layoutAxisLabels(ticks, 126, { referenceKey: 1 }).hidden]).toEqual([0]);
    expect(ticks).toEqual(before);
  });
  it("measures each horizontal label independently", () => {
    const ticks = labels([0, 0.15, 0.6, 1], [32, 24, 8, 40]);
    expect([...layoutAxisLabels(ticks, 128).hidden]).toEqual([1]);
    expect([...layoutAxisLabels(ticks, 320).hidden]).toEqual([]);
  });
  it.each([false, true])(
    "keeps the latest visible time rather than a hard-coded zero (%s reversed)",
    (reversed) => {
      const ticks = labels(reversed ? [1, 0.5, 0] : [0, 0.5, 1], [24, 24, 24]);
      expect([...layoutAxisLabels(ticks, 30, { policy: "time" }).hidden].sort()).toEqual([0, 1]);
    }
  );
  it("reserves enough room for a complete fixed group with unequal labels", () => {
    const ticks = labels([0, 0.5, 1], [20, 8, 24]);
    expect(minimumAxisLabelExtent(ticks)).toBe(64);
    const fitted = layoutAxisLabels(ticks, 30, { policy: "fixed" });
    expect(fitted.hidden.size).toBe(0);
    expect(fitted.minExtent).toBe(64);
    expect(layoutAxisLabels(ticks, 64).hidden.size).toBe(0);
  });
  it("does not assign semantic importance to numeric zero unless explicitly requested", () => {
    const ticks = labels([0, 0.04, 1]).map((tick, index) => ({ ...tick, key: [3, 0, -60][index] }));
    expect([...layoutAxisLabels(ticks, 126).hidden]).toEqual([0]);
    expect([...layoutAxisLabels(ticks, 126, { referenceKey: 0 }).hidden]).toEqual([3]);
  });
  it("keeps candidates until usable measurements exist, and handles an empty scale", () => {
    expect(layoutAxisLabels(labels([0, 1]), 0).hidden.size).toBe(0);
    expect(layoutAxisLabels(labels([0, 1], [0, 12]), 100).hidden.size).toBe(0);
    expect(layoutAxisLabels([], 100).hidden.size).toBe(0);
  });
});
