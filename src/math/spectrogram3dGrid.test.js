import { describe, expect, it } from "vitest";
import { sampleWaterfallGrid } from "./spectrogram3dGrid.js";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";

const SAMPLE_MS = 40;

function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}

/** Frames at given timestamps, every band held at the same dB so assertions stay readable. */
function framesAt(timestamps, db) {
  return viewOf(
    timestamps.map((timestampMs) => ({
      timestampMs,
      bands: [{ fCenter: 100 }, { fCenter: 1000 }],
      dbList: [db, db],
    }))
  );
}

function evenly(startMs, endMs, step = SAMPLE_MS) {
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += step) out.push(ts);
  return out;
}

const Y_TO_BAND = Int16Array.from([0, 1]);

const BASE = {
  oldestMs: 0,
  span: 400,
  maxRidges: 10,
  yToBand: Y_TO_BAND,
};

describe("sampleWaterfallGrid", () => {
  it("places each ridge at its own timestamp within the window", () => {
    const timestamps = [0, 100, 200, 300, 400];
    const view = framesAt(timestamps, -20);
    const grid = sampleWaterfallGrid({
      ...BASE,
      view,
      startIdx: 0,
      endIdx: timestamps.length - 1,
    });
    expect(grid.count).toBe(5);
    expect(Array.from(grid.tFracs.subarray(0, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  // The whole point of the module: a ridge is a moment that travels, not a fixed screen slot that
  // gets re-fed. Sliding the window must move every ridge by the same amount rather than re-bind
  // ridges to different frames.
  it("translates every ridge by the same amount when the window slides", () => {
    const timestamps = evenly(0, 800);
    const view = framesAt(timestamps, -20);
    const args = { ...BASE, view, startIdx: 0, endIdx: timestamps.length - 1, maxRidges: 40 };

    const before = sampleWaterfallGrid(args);
    const after = sampleWaterfallGrid({ ...args, oldestMs: 10 });

    expect(after.count).toBe(before.count);
    const shift = before.tFracs[0] - after.tFracs[0];
    expect(shift).toBeCloseTo(10 / BASE.span, 12);
    for (let r = 0; r < before.count; r++) {
      expect(before.tFracs[r] - after.tFracs[r]).toBeCloseTo(shift, 12);
    }
  });

  // Bucket edges anchored to the window would re-select different frames on every slide, which is
  // what makes a waterfall shimmer instead of flow.
  it("keeps selecting the same frames as the window slides", () => {
    const timestamps = evenly(0, 2000);
    const view = framesAt(timestamps, -20);
    const args = { ...BASE, view, startIdx: 0, endIdx: timestamps.length - 1, maxRidges: 12 };

    const at0 = sampleWaterfallGrid({ ...args, oldestMs: 0, span: 1000 });
    const at37 = sampleWaterfallGrid({ ...args, oldestMs: 37, span: 1000 });

    // Recover absolute timestamps from the fractions and compare the selected sets.
    const abs = (g, oldestMs, span) =>
      Array.from(g.tFracs.subarray(0, g.count)).map((f) => Math.round(f * span + oldestMs));
    const setA = abs(at0, 0, 1000);
    const setB = abs(at37, 37, 1000);
    const shared = setA.filter((ts) => setB.includes(ts));
    expect(shared.length).toBeGreaterThanOrEqual(setA.length - 1);
  });

  it("never exceeds maxRidges", () => {
    const timestamps = evenly(0, 400, 4);
    const view = framesAt(timestamps, -20);
    const grid = sampleWaterfallGrid({
      ...BASE,
      view,
      startIdx: 0,
      endIdx: timestamps.length - 1,
      maxRidges: 7,
    });
    expect(grid.count).toBeLessThanOrEqual(7);
    expect(grid.count).toBeGreaterThan(0);
  });

  it("normalises dB to 0..1 across the spectrogram range", () => {
    const top = sampleWaterfallGrid({
      ...BASE,
      view: framesAt([0, 100], SPECTROGRAM_DB_MAX),
      startIdx: 0,
      endIdx: 1,
    });
    expect(top.heights[0]).toBeCloseTo(1, 6);

    const floor = sampleWaterfallGrid({
      ...BASE,
      view: framesAt([0, 100], SPECTROGRAM_DB_MIN - 50),
      startIdx: 0,
      endIdx: 1,
    });
    expect(floor.heights[0]).toBe(0);
  });

  // A gap contributes no frames, so it contributes no ridges -- the 3D equivalent of the blank
  // columns the 2D heatmap leaves. Nothing should be stretched across it.
  it("leaves a real timestamp gap empty of ridges", () => {
    const timestamps = [0, 40, 960, 1000];
    const view = framesAt(timestamps, -20);
    const grid = sampleWaterfallGrid({
      ...BASE,
      view,
      startIdx: 0,
      endIdx: timestamps.length - 1,
      oldestMs: 0,
      span: 1000,
      maxRidges: 25,
    });
    const fracs = Array.from(grid.tFracs.subarray(0, grid.count));
    // Nothing lands in the middle of the dropout.
    expect(fracs.some((f) => f > 0.15 && f < 0.9)).toBe(false);
    // Both ends still produce ridges.
    expect(fracs.some((f) => f <= 0.15)).toBe(true);
    expect(fracs.some((f) => f >= 0.9)).toBe(true);
  });

  it("returns an empty grid when the window holds no frames", () => {
    const grid = sampleWaterfallGrid({
      ...BASE,
      view: viewOf([]),
      startIdx: 0,
      endIdx: -1,
    });
    expect(grid.count).toBe(0);
    expect(grid.pointCount).toBe(2);
  });

  it("skips frames that carry no levels", () => {
    const view = viewOf([
      { timestampMs: 0, bands: [], dbList: null },
      { timestampMs: 200, bands: [], dbList: [-20, -20] },
    ]);
    const grid = sampleWaterfallGrid({ ...BASE, view, startIdx: 0, endIdx: 1 });
    expect(grid.count).toBe(1);
    expect(grid.tFracs[0]).toBeCloseTo(0.5, 12);
  });
});
