import { describe, it, expect } from "vitest";
import {
  getHistoryViewport,
  buildHistoryPath,
  buildLoudnessYAxisTicks,
  HISTORY_MIN_WINDOW_SEC,
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_TIME_TICK_STEPS,
  buildHistoryTimeAxisLabels,
  buildMediaTimeAxisLabels,
  mediaTimeAxisRangeSec,
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
  it("keeps the full visible window when fewer samples exist", () => {
    const { visibleSamples } = getHistoryViewport(10, 120, 0, 0.1);
    expect(visibleSamples).toBe(1200);
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

describe("buildMediaTimeAxisLabels", () => {
  it("returns one more label than HISTORY_TIME_TICK_STEPS", () => {
    expect(buildMediaTimeAxisLabels(0, 120)).toHaveLength(HISTORY_TIME_TICK_STEPS + 1);
  });
  it("counts up from oldest (left) to newest (right) media time", () => {
    const labels = buildMediaTimeAxisLabels(0, 120);
    expect(labels[0]).toBe("0s");
    expect(labels[labels.length - 1]).toBe("2m");
  });
  it("brackets a sub-minute window with second labels", () => {
    const labels = buildMediaTimeAxisLabels(0, 60);
    expect(labels[0]).toBe("0s");
    expect(labels[labels.length - 1]).toBe("1m");
  });
  it("labels are non-decreasing in seconds", () => {
    const labels = buildMediaTimeAxisLabels(10, 200);
    const toSec = (lb) => {
      const m = lb.match(/^(?:(\d+)m)?(?:(\d+)s)?$/);
      return Number(m[1] || 0) * 60 + Number(m[2] || 0);
    };
    for (let i = 0; i < labels.length - 1; i++) {
      expect(toSec(labels[i + 1])).toBeGreaterThanOrEqual(toSec(labels[i]));
    }
  });
});

describe("mediaTimeAxisRangeSec", () => {
  it("spans 0 -> newest when the whole file is visible at offset 0", () => {
    const { startSec, endSec } = mediaTimeAxisRangeSec(600, 0, 600, 0.1);
    expect(startSec).toBe(0);
    expect(endSec).toBeCloseTo(59.9, 5);
  });
  it("shifts the window earlier as the pan offset grows", () => {
    const { startSec, endSec } = mediaTimeAxisRangeSec(1000, 100, 200, 0.1);
    expect(endSec).toBeCloseTo(89.9, 5);
    expect(startSec).toBeCloseTo(70, 5);
  });
  it("clamps to zero for an empty history", () => {
    expect(mediaTimeAxisRangeSec(0, 0, 600, 0.1)).toEqual({ startSec: 0, endSec: 0 });
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
  it("right-aligns partial live data inside the full visible window", () => {
    const list = [{ m: -23 }, { m: -20 }, { m: -18 }];
    const path = buildHistoryPath(list, "m", 5, 0, (v) => v, 400);
    expect(path).toBe("M 200 -23 L 300 -20 L 400 -18");
  });
  it("bounds node count by the pixel budget when samples vastly outnumber columns", () => {
    const list = Array.from({ length: 60000 }, (_, i) => ({ m: -40 + (i % 20) }));
    const cols = 600;
    const path = buildHistoryPath(list, "m", 60000, 0, (v) => v, 600, cols);
    const nodes = (path.match(/[ML]/g) ?? []).length;
    // Decimated envelope emits at most 2 points per column; far below the 60000 raw samples.
    expect(nodes).toBeLessThanOrEqual(2 * cols);
    expect(nodes).toBeGreaterThan(cols); // did decimate to an envelope, not a single line
    expect(path).toMatch(/^M /);
  });
  it("preserves per-column peaks in the decimated envelope", () => {
    // One tall spike inside an otherwise flat window must survive decimation.
    const list = Array.from({ length: 6000 }, (_, i) => ({ m: i === 3000 ? 0 : -60 }));
    const path = buildHistoryPath(list, "m", 6000, 0, (v) => v, 600, 600);
    expect(path).toContain(" 0 "); // the spike's y-value is present
  });
});

describe("buildLoudnessYAxisTicks", () => {
  const base = [
    { v: -10, lb: "-10" },
    { v: -23, lb: "-23" },
    { v: -40, lb: "-40" },
  ];

  it("does not duplicate a target already in the base list", () => {
    const result = buildLoudnessYAxisTicks(-23, base);
    const count = result.filter((t) => t.v === -23).length;
    expect(count).toBe(1);
  });

  it("inserts the target when not present", () => {
    const result = buildLoudnessYAxisTicks(-18, base);
    expect(result.some((t) => t.v === -18)).toBe(true);
    expect(result.length).toBe(base.length + 1);
  });

  it("returns ticks sorted descending by v", () => {
    const result = buildLoudnessYAxisTicks(-18, base);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].v).toBeGreaterThan(result[i + 1].v);
    }
  });

  it("does not mutate the base array", () => {
    const original = [...base];
    buildLoudnessYAxisTicks(-18, base);
    expect(base).toEqual(original);
  });
});
