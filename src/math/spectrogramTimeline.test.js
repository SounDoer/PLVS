import { describe, expect, it } from "vitest";
import {
  spectrogramTimeWindow,
  spectrogramFrameEndMs,
  inWindowRange,
  spectrogramDataBoundaryMarkers,
  spectrogramDataBoundaries,
} from "./spectrogramTimeline.js";

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

function frames(startMs, endMs, step = SAMPLE_MS) {
  const rows = [];
  for (let ts = startMs; ts <= endMs; ts += step) rows.push({ timestampMs: ts });
  return viewOf(rows);
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

  it("spans the full requested window when fewer samples exist (right-aligned, no stretch)", () => {
    // 3 samples at 100ms spacing, but the window asks for 10 samples. The window must still cover
    // 10 samples back in time (oldest extrapolated to newest - 9*interval), matching the
    // index-based loudness/waveform panels, instead of stretching 3 samples across the whole view.
    const partial = [{ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1200 }];
    expect(spectrogramTimeWindow(partial, 0, 10, 100)).toEqual({ oldestMs: 300, newestMs: 1200 });
  });

  it("uses the nominal history interval for partial windows instead of amplifying timestamp jitter", () => {
    const jittered = [{ timestampMs: 1000 }, { timestampMs: 1097 }, { timestampMs: 1203 }];
    expect(spectrogramTimeWindow(jittered, 0, 10, 100)).toEqual({
      oldestMs: 303,
      newestMs: 1203,
    });
  });
});

describe("spectrogramFrameEndMs", () => {
  it("stitches small timestamp jitter to the next frame", () => {
    const f = viewOf([{ timestampMs: 1000 }, { timestampMs: 1043 }, { timestampMs: 1081 }]);
    expect(spectrogramFrameEndMs(f, 0, SAMPLE_MS)).toBe(1043);
    expect(spectrogramFrameEndMs(f, 1, SAMPLE_MS)).toBe(1081);
  });

  it("keeps real gaps blank", () => {
    const f = viewOf([{ timestampMs: 1000 }, { timestampMs: 1120 }]);
    expect(spectrogramFrameEndMs(f, 0, SAMPLE_MS)).toBe(1040);
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
    expect(inWindowRange(viewOf([]), 100, 200)).toEqual({ startIdx: 0, endIdx: -1 });
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
    const rows = [];
    for (let ts = 800; ts <= 1200; ts += SAMPLE_MS) rows.push({ timestampMs: ts });
    for (let ts = 1600; ts <= 2000; ts += SAMPLE_MS) rows.push({ timestampMs: ts });
    const f = viewOf(rows);
    expect(spectrogramDataBoundaries(f, 900, 1900, SAMPLE_MS)).toEqual([1240, 1600]);
  });

  it("returns no markers for empty input or a degenerate window", () => {
    expect(spectrogramDataBoundaries(viewOf([]), 1000, 2000, SAMPLE_MS)).toEqual([]);
    expect(spectrogramDataBoundaries(frames(1000, 1200), 1500, 1500, SAMPLE_MS)).toEqual([]);
  });
});

describe("spectrogramDataBoundaryMarkers", () => {
  it("labels leading and trailing data boundaries", () => {
    expect(spectrogramDataBoundaryMarkers(frames(1500, 2100), 1000, 2000, SAMPLE_MS)).toEqual([
      { ts: 1500, label: "Data starts here" },
    ]);
    expect(spectrogramDataBoundaryMarkers(frames(900, 1500), 1000, 2000, SAMPLE_MS)).toEqual([
      { ts: 1540, label: "Data ends here" },
    ]);
  });
});
