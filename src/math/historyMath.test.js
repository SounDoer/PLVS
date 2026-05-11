import { describe, it, expect } from "vitest";
import {
  getHistoryViewport,
  buildHistoryPath,
  HISTORY_MIN_WINDOW_SEC,
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_TIME_TICK_STEPS,
  buildHistoryTimeAxisLabels,
} from "./historyMath";

describe("getHistoryViewport", () => {
  it("clamps window below minimum", () => {
    const { clampedWindowSec } = getHistoryViewport(100, 1, 0, 0.1);
    expect(clampedWindowSec).toBe(HISTORY_MIN_WINDOW_SEC);
  });
  it("clamps window above maximum", () => {
    const { clampedWindowSec } = getHistoryViewport(100, 99999, 0, 0.1);
    expect(clampedWindowSec).toBe(HISTORY_MAX_WINDOW_SEC);
  });
  it("visible samples cannot exceed total samples", () => {
    const { visibleSamples } = getHistoryViewport(10, 120, 0, 0.1);
    expect(visibleSamples).toBeLessThanOrEqual(10);
  });
  it("offset is clamped within available range", () => {
    const { effectiveOffsetSamples, maxOffsetSamples } = getHistoryViewport(100, 5, 9999, 0.1);
    expect(effectiveOffsetSamples).toBeLessThanOrEqual(maxOffsetSamples);
  });
  it("offset of 0 produces effectiveOffsetSec of 0", () => {
    const { effectiveOffsetSec } = getHistoryViewport(100, 10, 0, 0.1);
    expect(effectiveOffsetSec).toBe(0);
  });
  it("maxOffsetSamples is zero when all samples are visible", () => {
    const { maxOffsetSamples } = getHistoryViewport(5, 120, 0, 0.1);
    expect(maxOffsetSamples).toBe(0);
  });
});

describe("buildHistoryTimeAxisLabels", () => {
  it("returns one more label than HISTORY_TIME_TICK_STEPS", () => {
    const labels = buildHistoryTimeAxisLabels(0, 120);
    expect(labels).toHaveLength(HISTORY_TIME_TICK_STEPS + 1);
  });
  it("brackets a 60s window with oldest and youngest tick labels", () => {
    const labels = buildHistoryTimeAxisLabels(0, 60);
    expect(labels[0]).toBe("1m");
    expect(labels[labels.length - 1]).toBe("0s");
  });
});

describe("buildHistoryPath", () => {
  it("returns empty string for an empty list", () => {
    expect(buildHistoryPath([], "m", 10, 0, (v) => v)).toBe("");
  });
  it("returns empty string for a single-sample list", () => {
    expect(buildHistoryPath([{ m: -23 }], "m", 10, 0, (v) => v)).toBe("");
  });
  it("starts with 'M' for valid input", () => {
    const list = [{ m: -23 }, { m: -20 }, { m: -18 }];
    const path = buildHistoryPath(list, "m", 10, 0, (v) => v);
    expect(path).toMatch(/^M /);
  });
  it("uses the correct key from each sample", () => {
    const list = [
      { m: -23, st: -20 },
      { m: -18, st: -10 },
      { m: -15, st: -8 },
    ];
    const mPath = buildHistoryPath(list, "m", 10, 0, (v) => v);
    const stPath = buildHistoryPath(list, "st", 10, 0, (v) => v);
    expect(mPath).not.toBe(stPath);
  });
  it("applies the toY transform to each point", () => {
    const list = [{ m: 0 }, { m: 0 }, { m: 0 }];
    const path = buildHistoryPath(list, "m", 10, 0, () => 42);
    expect(path).toContain("42");
  });
});
