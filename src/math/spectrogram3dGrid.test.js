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
  sampleMs: SAMPLE_MS,
  maxRidges: 10,
  yToBand: Y_TO_BAND,
  dbFloor: SPECTROGRAM_DB_MIN,
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

  // The window's edges are real captured timestamps, so span jitters by a few ms on every history
  // update. A stride derived straight from span would move every bucket edge, frames near an edge
  // would flip in and out of the selection, and ridges would blink. Quantising the stride to whole
  // frame periods must make the selection immune to that jitter.
  it("selects the same frames despite window jitter", () => {
    const timestamps = evenly(0, 4000);
    const view = framesAt(timestamps, -20);
    const args = { ...BASE, view, startIdx: 0, endIdx: timestamps.length - 1, maxRidges: 30 };

    const selected = (span) => {
      const g = sampleWaterfallGrid({ ...args, oldestMs: 0, span });
      return Array.from(g.tFracs.subarray(0, g.count)).map((f) => Math.round(f * span));
    };

    const reference = selected(2000);
    for (const jitter of [-7, -3, 2, 5, 9]) {
      expect(selected(2000 + jitter)).toEqual(reference);
    }
  });

  // Frames leaving the old end must not disturb the ones still on screen. Seeding the bucket state
  // with NaN force-keeps whichever frame currently sits first in the window, so as the edge advances
  // the oldest ridge keeps re-binding to a different frame at an arbitrary phase within its bucket
  // -- it visibly changes shape and position for several updates before finally dropping out.
  it("does not re-phase the selection as frames leave the old end", () => {
    const timestamps = evenly(0, 4000);
    const view = framesAt(timestamps, -20);
    // maxRidges is deliberately generous so the cap never binds; otherwise advancing the left edge
    // also pulls an extra frame in at the right, and "only drops from the front" stops holding.
    const args = { ...BASE, view, span: 4000, maxRidges: 60, endIdx: timestamps.length - 1 };

    const pick = (startIdx) => {
      const g = sampleWaterfallGrid({ ...args, startIdx, oldestMs: 0 });
      return Array.from(g.tFracs.subarray(0, g.count)).map((f) => Math.round(f * 4000));
    };

    const full = pick(0);
    // Advancing the window's leading edge one frame at a time must only ever drop frames from the
    // front of the selection, never change which of the remaining frames were chosen.
    for (let startIdx = 1; startIdx <= 12; startIdx++) {
      const later = pick(startIdx);
      expect(full.slice(full.length - later.length)).toEqual(later);
    }
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

  // The top of the range stays pinned at SPECTROGRAM_DB_MAX, so raising the floor compresses the
  // range from below: a fixed dB value that isn't right at the top ends up relatively closer to
  // the (now nearer) floor, so its own normalised height drops even though loud values spread
  // further apart from each other -- the standard "raise the black point" effect.
  it("changes the normalised height of a given dB value when the floor is raised", () => {
    const db = -40;
    const atDefaultFloor = sampleWaterfallGrid({
      ...BASE,
      view: framesAt([0, 100], db),
      startIdx: 0,
      endIdx: 1,
    });
    const atRaisedFloor = sampleWaterfallGrid({
      ...BASE,
      dbFloor: -60,
      view: framesAt([0, 100], db),
      startIdx: 0,
      endIdx: 1,
    });
    expect(atRaisedFloor.heights[0]).toBeLessThan(atDefaultFloor.heights[0]);
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

  // The stride is returned so per-bucket tolerances can scale by the actual decimation stride
  // rather than by the row count -- at capture start the rows all sit at one end of the window,
  // and a tolerance derived from span / count smears them across the empty rest of it.
  it("returns the bucket stride, quantised to whole frame periods", () => {
    const view = framesAt(evenly(0, 4000), -20);
    // span 1000 / maxRidges 12 -> raw 83.3 ms -> 2 whole 40 ms periods.
    const grid = sampleWaterfallGrid({
      ...BASE,
      view,
      startIdx: 0,
      endIdx: 25,
      span: 1000,
      maxRidges: 12,
    });
    expect(grid.strideMs).toBe(80);
  });

  it("returns the raw stride when the frame period is unusable", () => {
    const view = framesAt(evenly(0, 400), -20);
    const grid = sampleWaterfallGrid({
      ...BASE,
      view,
      startIdx: 0,
      endIdx: 10,
      sampleMs: NaN,
    });
    expect(grid.strideMs).toBe(BASE.span / BASE.maxRidges);
  });

  it("returns the stride even when the window holds no frames", () => {
    const grid = sampleWaterfallGrid({
      ...BASE,
      view: viewOf([]),
      startIdx: 0,
      endIdx: -1,
    });
    expect(grid.strideMs).toBe(40); // span 400 / maxRidges 10 = 1 x 40 ms
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
