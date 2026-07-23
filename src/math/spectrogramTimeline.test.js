import { describe, expect, it } from "vitest";
import {
  spectrogramTimeWindow,
  spectrogramFrameEndMs,
  inWindowRange,
  spectrogramDataBoundaryMarkers,
  spectrogramDataBoundaries,
} from "./spectrogramTimeline.js";
import { SpectrumHistorySlab } from "../lib/SpectrumHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "../lib/historyChunkConfig.js";

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

function slabOf(timestamps) {
  const slab = new SpectrumHistorySlab(Math.max(1, timestamps.length), []);
  for (const timestampMs of timestamps) slab.push({ bands: [], dbList: [], timestampMs });
  return slab;
}

function differentialViews(timestamps, capacity = timestamps.length) {
  const live = new SpectrumHistorySlab(Math.max(1, capacity), []);
  for (const timestampMs of timestamps) live.push({ bands: [], dbList: [], timestampMs });
  const retained = timestamps.slice(-capacity);
  return {
    reference: viewOf(retained.map((timestampMs) => ({ timestampMs }))),
    live,
    frozen: live.freeze(),
  };
}

function expectOptimizedViewsToMatchReference(
  timestamps,
  oldestMs,
  newestMs,
  capacity = timestamps.length
) {
  const { reference, live, frozen } = differentialViews(timestamps, capacity);
  const expected = spectrogramDataBoundaryMarkers(reference, oldestMs, newestMs, SAMPLE_MS);
  expect(spectrogramDataBoundaryMarkers(live, oldestMs, newestMs, SAMPLE_MS)).toEqual(expected);
  expect(spectrogramDataBoundaryMarkers(frozen, oldestMs, newestMs, SAMPLE_MS)).toEqual(expected);
  return { expected, live, frozen };
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

  it.each([
    {
      name: "finite to non-finite to finite",
      timestamps: [1000, 1040, Number.NaN, 1120, 1160],
      oldestMs: 900,
      newestMs: 1300,
      expected: [{ ts: 1000, label: "Data starts here" }],
    },
    {
      name: "leading non-finite",
      timestamps: [Number.NaN, 1000, 1040],
      oldestMs: 900,
      newestMs: 1300,
      expected: [{ ts: 1080, label: "Data ends here" }],
    },
    {
      name: "trailing non-finite",
      timestamps: [1000, 1040, Number.NaN],
      oldestMs: 900,
      newestMs: 1300,
      expected: [{ ts: 1000, label: "Data starts here" }],
    },
    {
      name: "delta at and just above threshold",
      timestamps: [1000, 1072, 1145],
      oldestMs: 900,
      newestMs: 1250,
      expected: [
        { ts: 1000, label: "Data starts here" },
        { ts: 1112, label: "Data ends here" },
        { ts: 1145, label: "Data starts here" },
        { ts: 1185, label: "Data ends here" },
      ],
    },
  ])(
    "matches plain-array reference markers for $name",
    ({ timestamps, oldestMs, newestMs, expected }) => {
      const result = expectOptimizedViewsToMatchReference(timestamps, oldestMs, newestMs);
      expect(result.expected).toEqual(expected);
    }
  );

  it("matches plain-array reference markers across a chunk boundary", () => {
    const timestamps = Array.from(
      { length: VISUAL_HISTORY_CHUNK_ROWS + 3 },
      (_, index) => 1000 + index * SAMPLE_MS
    );
    timestamps[VISUAL_HISTORY_CHUNK_ROWS - 1] = Number.NaN;

    const { live } = expectOptimizedViewsToMatchReference(
      timestamps,
      900,
      1000 + timestamps.length * SAMPLE_MS
    );
    expect(live.lastGapQueryStats().rowsScanned).toBeLessThanOrEqual(VISUAL_HISTORY_CHUNK_ROWS);
  });

  it("matches plain-array reference markers after partial oldest-chunk eviction", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 5;
    const timestamps = Array.from(
      { length: VISUAL_HISTORY_CHUNK_ROWS * 2 + 10 },
      (_, index) => 1000 + index * SAMPLE_MS
    );
    timestamps[VISUAL_HISTORY_CHUNK_ROWS + 20] = Number.NaN;
    const retained = timestamps.slice(-capacity).filter(Number.isFinite);

    const { live } = expectOptimizedViewsToMatchReference(
      timestamps,
      retained[0] - SAMPLE_MS,
      retained.at(-1) + SAMPLE_MS,
      capacity
    );
    expect(live.lastGapQueryStats().rowsScanned).toBeLessThanOrEqual(VISUAL_HISTORY_CHUNK_ROWS);
  });

  it.each([
    {
      name: "continuous",
      timestamps: Array.from({ length: 31 }, (_, index) => 800 + index * 40),
      oldestMs: 1000,
      newestMs: 1800,
    },
    {
      name: "interior gap",
      timestamps: [
        ...Array.from({ length: 11 }, (_, index) => 800 + index * 40),
        ...Array.from({ length: 11 }, (_, index) => 1600 + index * 40),
      ],
      oldestMs: 900,
      newestMs: 1900,
    },
    {
      name: "boundary jitter",
      timestamps: [900, 941, 979, 1022, 1061, 1099, 1300, 1342, 1380, 1421],
      oldestMs: 940,
      newestMs: 1381,
    },
    {
      name: "window clip",
      timestamps: [800, 840, 880, 1200, 1240, 1280, 1800, 1840, 1880],
      oldestMs: 1200,
      newestMs: 1840,
    },
  ])("matches the reference fallback for $name", ({ timestamps, oldestMs, newestMs }) => {
    const fallback = viewOf(timestamps.map((timestampMs) => ({ timestampMs })));
    const optimized = slabOf(timestamps);

    expect(spectrogramDataBoundaryMarkers(optimized, oldestMs, newestMs, SAMPLE_MS)).toEqual(
      spectrogramDataBoundaryMarkers(fallback, oldestMs, newestMs, SAMPLE_MS)
    );
  });

  it("does not scan a 240 minute continuous timestamp payload", () => {
    const rowCount = 360_000;
    const optimized = new SpectrumHistorySlab(rowCount, []);
    for (let index = 0; index < rowCount; index += 1) {
      optimized.push({ bands: [], dbList: [], timestampMs: index * SAMPLE_MS });
    }

    expect(
      spectrogramDataBoundaryMarkers(optimized, 0, (rowCount - 1) * SAMPLE_MS, SAMPLE_MS)
    ).toEqual([]);
    expect(optimized.lastGapQueryStats().rowsScanned).toBe(0);
  });
});
