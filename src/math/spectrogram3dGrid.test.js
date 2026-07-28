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

/** Frames at a fixed cadence, every band held at the same dB so assertions stay readable. */
function framesAt(timestamps, db) {
  return viewOf(
    timestamps.map((timestampMs) => ({
      timestampMs,
      bands: [{ fCenter: 100 }, { fCenter: 1000 }],
      dbList: [db, db],
    }))
  );
}

const Y_TO_BAND = Int16Array.from([0, 1]);

describe("sampleWaterfallGrid", () => {
  it("produces exactly ridgeCount ridges regardless of frame count", () => {
    const view = framesAt([0, 40, 80, 120, 160, 200], -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 5,
      oldestMs: 0,
      span: 240,
      sampleMs: SAMPLE_MS,
      ridgeCount: 4,
      yToBand: Y_TO_BAND,
    });
    expect(grid.present).toHaveLength(4);
    expect(grid.timestamps).toHaveLength(4);
    expect(grid.heights).toHaveLength(4 * 2);
    expect(grid.pointCount).toBe(2);
  });

  it("normalises dB to 0..1 across the spectrogram range", () => {
    const view = framesAt([0, 40], SPECTROGRAM_DB_MAX);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 1,
      oldestMs: 0,
      span: 80,
      sampleMs: SAMPLE_MS,
      ridgeCount: 2,
      yToBand: Y_TO_BAND,
    });
    expect(grid.heights[0]).toBeCloseTo(1, 6);

    const floor = framesAt([0, 40], SPECTROGRAM_DB_MIN - 50);
    const floorGrid = sampleWaterfallGrid({
      view: floor,
      startIdx: 0,
      endIdx: 1,
      oldestMs: 0,
      span: 80,
      sampleMs: SAMPLE_MS,
      ridgeCount: 2,
      yToBand: Y_TO_BAND,
    });
    expect(floorGrid.heights[0]).toBe(0);
  });

  // The 2D path leaves genuine timestamp gaps unpainted. 3D must not invent a surface across them.
  it("marks ridges inside a real timestamp gap as absent", () => {
    const view = framesAt([0, 40, 1000, 1040], -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 3,
      oldestMs: 0,
      span: 1080,
      sampleMs: SAMPLE_MS,
      ridgeCount: 12,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present)).toContain(0);
    expect(Array.from(grid.present)).toContain(1);
    // The gap sits in the middle of the window, so a mid ridge must be absent.
    expect(grid.present[6]).toBe(0);
  });

  it("marks every ridge present when frames are continuous", () => {
    const timestamps = [];
    for (let ts = 0; ts <= 400; ts += SAMPLE_MS) timestamps.push(ts);
    const view = framesAt(timestamps, -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: timestamps.length - 1,
      oldestMs: 0,
      span: 400,
      sampleMs: SAMPLE_MS,
      ridgeCount: 8,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present).every((v) => v === 1)).toBe(true);
  });

  it("returns an empty grid when the window holds no frames", () => {
    const grid = sampleWaterfallGrid({
      view: viewOf([]),
      startIdx: 0,
      endIdx: -1,
      oldestMs: 0,
      span: 100,
      sampleMs: SAMPLE_MS,
      ridgeCount: 4,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present).every((v) => v === 0)).toBe(true);
  });
});
