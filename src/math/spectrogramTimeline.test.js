import { describe, expect, it } from "vitest";
import {
  spectrogramTimeWindow,
  inWindowRange,
  spectrogramDataBoundaries,
} from "./spectrogramTimeline.js";

const SAMPLE_MS = 40;

function frames(startMs, endMs, step = SAMPLE_MS) {
  const out = [];
  for (let ts = startMs; ts <= endMs; ts += step) out.push({ timestampMs: ts });
  return out;
}

describe("spectrogramTimeWindow", () => {
  const hist = [{ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1200 }];

  it("derives the window from offset and visible width", () => {
    expect(spectrogramTimeWindow(hist, 0, 3)).toEqual({ oldestMs: 1000, newestMs: 1200 });
    expect(spectrogramTimeWindow(hist, 0, 2)).toEqual({ oldestMs: 1100, newestMs: 1200 });
    expect(spectrogramTimeWindow(hist, 1, 2)).toEqual({ oldestMs: 1000, newestMs: 1100 });
  });

  it("clamps offset and visible to the available range", () => {
    expect(spectrogramTimeWindow(hist, 99, 99)).toEqual({ oldestMs: 1000, newestMs: 1000 });
  });

  it("returns null when history has no timestamps", () => {
    expect(spectrogramTimeWindow([], 0, 3)).toBeNull();
    expect(spectrogramTimeWindow([{}], 0, 3)).toBeNull();
  });
});

describe("inWindowRange", () => {
  const f = frames(100, 220); // 100,140,180,220

  it("finds the index range inside the window", () => {
    expect(inWindowRange(f, 140, 180)).toEqual({ startIdx: 1, endIdx: 2 });
    expect(inWindowRange(f, 100, 220)).toEqual({ startIdx: 0, endIdx: 3 });
  });

  it("returns an empty range when no frame is inside", () => {
    expect(inWindowRange(f, 300, 400)).toEqual({ startIdx: 0, endIdx: -1 });
    expect(inWindowRange([], 100, 200)).toEqual({ startIdx: 0, endIdx: -1 });
  });
});

describe("spectrogramDataBoundaries", () => {
  it("emits no markers for a continuous capture spanning the window", () => {
    const f = frames(1000, 2000);
    expect(spectrogramDataBoundaries(f, 1100, 1900, SAMPLE_MS)).toEqual([]);
  });

  it("marks where data appears after a leading gap", () => {
    // data only starts at 1500; capture continues past the window end (no trailing mark).
    const f = frames(1500, 2100);
    expect(spectrogramDataBoundaries(f, 1000, 2000, SAMPLE_MS)).toEqual([1500]);
  });

  it("marks where data stops before a trailing gap", () => {
    // data exists before the window and stops at 1500.
    const f = frames(900, 1500);
    expect(spectrogramDataBoundaries(f, 1000, 2000, SAMPLE_MS)).toEqual([1540]);
  });

  it("marks both edges of an interior gap (switch back and forth)", () => {
    const f = [...frames(800, 1200), ...frames(1600, 2000)];
    expect(spectrogramDataBoundaries(f, 900, 1900, SAMPLE_MS)).toEqual([1240, 1600]);
  });

  it("returns no markers for empty input or a degenerate window", () => {
    expect(spectrogramDataBoundaries([], 1000, 2000, SAMPLE_MS)).toEqual([]);
    expect(spectrogramDataBoundaries(frames(1000, 1200), 1500, 1500, SAMPLE_MS)).toEqual([]);
  });
});
