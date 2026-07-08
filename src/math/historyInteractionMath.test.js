import { describe, expect, it } from "vitest";
import {
  computeSelectionOffset,
  computePanOffset,
  computeWheelZoom,
} from "./historyInteractionMath";

const rect = (left, width) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0 });

describe("computeSelectionOffset", () => {
  it("returns 0 when pointer is at the right edge (most recent)", () => {
    const r = rect(0, 600);
    expect(computeSelectionOffset(600, r, 0, 100, 0.1)).toBe(0);
  });

  it("returns the full visible range when pointer is at the left edge", () => {
    const r = rect(0, 600);
    // normalized=1 → fromEnd=0+1*(100-1)=99 → 99*0.1=9.9
    expect(computeSelectionOffset(0, r, 0, 100, 0.1)).toBeCloseTo(9.9);
  });

  it("accounts for effectiveOffsetSamples", () => {
    const r = rect(0, 600);
    // pointer at right edge (x=600, norm=0) → fromEnd=50+0*99=50 → 50*0.1=5
    expect(computeSelectionOffset(600, r, 50, 100, 0.1)).toBeCloseTo(5);
  });

  it("clamps clientX below rect.left to left edge", () => {
    const r = rect(100, 600);
    const atLeft = computeSelectionOffset(50, r, 0, 100, 0.1);
    const exactLeft = computeSelectionOffset(100, r, 0, 100, 0.1);
    expect(atLeft).toBe(exactLeft);
  });

  it("clamps clientX above rect.right to right edge", () => {
    const r = rect(0, 600);
    const atRight = computeSelectionOffset(700, r, 0, 100, 0.1);
    const exactRight = computeSelectionOffset(600, r, 0, 100, 0.1);
    expect(atRight).toBe(exactRight);
  });

  it("clamps selection to the oldest available sample when the viewport extends before history", () => {
    const r = rect(0, 600);
    expect(computeSelectionOffset(0, r, 0, 100, 0.1, 10)).toBeCloseTo(0.9);
  });
});

describe("computePanOffset", () => {
  it("returns start offset when dx=0", () => {
    expect(computePanOffset(5, 0, 100, 0.1, 600, 20)).toBeCloseTo(5);
  });

  it("increases offset when dragging right (positive dx)", () => {
    const next = computePanOffset(0, 60, 100, 0.1, 600, 20);
    expect(next).toBeGreaterThan(0);
  });

  it("clamps to 0 when drag would produce negative offset", () => {
    expect(computePanOffset(0, -999, 100, 0.1, 600, 20)).toBe(0);
  });

  it("clamps to maxOffsetSec", () => {
    expect(computePanOffset(0, 999999, 100, 0.1, 600, 20)).toBe(20);
  });
});

describe("computeWheelZoom", () => {
  const base = {
    effectiveOffsetSamples: 0,
    visibleSamples: 100,
    sampleSec: 0.1,
    minWindowSec: 5,
    maxWindowSec: 300,
    totalSamples: 1000,
  };

  it("zoom in (factor < 1) reduces nextWindowSec", () => {
    const { nextWindowSec } = computeWheelZoom({ ...base, factor: 0.85, norm: 0.5 });
    expect(nextWindowSec).toBeLessThan(100 * 0.1);
  });

  it("zoom out (factor > 1) increases nextWindowSec", () => {
    const { nextWindowSec } = computeWheelZoom({ ...base, factor: 1.18, norm: 0.5 });
    expect(nextWindowSec).toBeGreaterThan(100 * 0.1);
  });

  it("clamps nextWindowSec to minWindowSec", () => {
    const { nextWindowSec } = computeWheelZoom({ ...base, factor: 0.0001, norm: 0.5 });
    expect(nextWindowSec).toBe(base.minWindowSec);
  });

  it("clamps nextWindowSec to maxWindowSec", () => {
    const { nextWindowSec } = computeWheelZoom({ ...base, factor: 999, norm: 0.5 });
    expect(nextWindowSec).toBe(base.maxWindowSec);
  });

  it("nextOffsetSec is >= 0", () => {
    const { nextOffsetSec } = computeWheelZoom({ ...base, factor: 1.5, norm: 0 });
    expect(nextOffsetSec).toBeGreaterThanOrEqual(0);
  });

  it("anchors correctly at right edge (norm=0) — offset stays at 0", () => {
    const { nextOffsetSec } = computeWheelZoom({
      ...base,
      effectiveOffsetSamples: 0,
      factor: 0.5,
      norm: 0,
    });
    expect(nextOffsetSec).toBe(0);
  });
});
