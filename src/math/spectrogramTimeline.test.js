import { describe, expect, it } from "vitest";
import {
  spectrogramTimeWindow,
  spectrogramRenderTimeWindow,
  spectrogramFrameEndMs,
  inWindowRange,
  spectrogramDataBoundaryMarkers,
  spectrogramDataBoundaries,
  resolveSpectrogramSampleMs,
  resolveStableSpectrogramSampleMs,
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

describe("spectrogramRenderTimeWindow", () => {
  const master = { oldestMs: 1000, newestMs: 1200 };

  it("uses the newer visual cadence to advance only the paint window", () => {
    expect(
      [1200, 1240, 1280].map(
        (visualNewestMs) =>
          spectrogramRenderTimeWindow(master, frames(1160, visualNewestMs), 100).newestMs
      )
    ).toEqual([1200, 1240, 1280]);
    expect(spectrogramRenderTimeWindow(master, frames(1160, 1280), 100)).toEqual({
      oldestMs: 1080,
      newestMs: 1280,
    });
    expect(master).toEqual({ oldestMs: 1000, newestMs: 1200 });
  });

  it("caps the advance at one master-history interval", () => {
    expect(spectrogramRenderTimeWindow(master, frames(1200, 1600), 100)).toEqual({
      oldestMs: 1100,
      newestMs: 1300,
    });
  });

  it("keeps the master window for missing, stale, or invalid visual time", () => {
    expect(spectrogramRenderTimeWindow(master, viewOf([]), 100)).toBe(master);
    expect(spectrogramRenderTimeWindow(master, frames(1000, 1160), 100)).toBe(master);
    expect(spectrogramRenderTimeWindow(null, frames(1200, 1280), 100)).toBeNull();
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

describe("resolveSpectrogramSampleMs", () => {
  it("falls back when the view has fewer than two rows", () => {
    expect(resolveSpectrogramSampleMs(viewOf([]), 40)).toBe(40);
    expect(resolveSpectrogramSampleMs(viewOf([{ timestampMs: 1000 }]), 40)).toBe(40);
  });

  it("infers the live ~40ms visual cadence from real timestamps", () => {
    const f = frames(1000, 1200, 40);
    expect(resolveSpectrogramSampleMs(f, 40)).toBe(40);
  });

  it("infers the coarser file-mode ~100ms cadence instead of the live constant", () => {
    // File-mode visual history batches at the main-history 100ms grid (see
    // docs/superpowers/specs/2026-06-29-sample-clocked-history-cadence-design.md), not the live
    // 40ms visual rate. A caller stuck on the 40ms constant would treat every consecutive frame as
    // a gap here, painting a blank stripe after each 40ms-wide column.
    const f = frames(1000, 1400, 100);
    expect(resolveSpectrogramSampleMs(f, 40)).toBe(100);
  });
});

describe("resolveStableSpectrogramSampleMs", () => {
  /** Frames whose intervals jitter within `[base, base + spread)`, as the live wall-clock gate does. */
  function jittery(startMs, count, base, spread) {
    const rows = [];
    let ts = startMs;
    for (let i = 0; i < count; i++) {
      rows.push({ timestampMs: ts });
      ts += base + ((i * 7) % spread);
    }
    return rows;
  }

  it("falls back when the view has fewer than two rows", () => {
    expect(resolveStableSpectrogramSampleMs(viewOf([]), 40)).toBe(40);
    expect(resolveStableSpectrogramSampleMs(viewOf([{ timestampMs: 1000 }]), 40)).toBe(40);
  });

  // The point of the whole function: the value must not move as frames arrive, or every caller that
  // quantises by it re-phases on every update.
  it("holds still as jittery frames arrive", () => {
    const rows = jittery(300_000, 200, 40, 9);
    const seen = new Set();
    for (let length = 40; length <= 200; length++) {
      seen.add(resolveStableSpectrogramSampleMs(viewOf(rows.slice(0, length)), 40));
    }
    expect([...seen]).toEqual([40]);
  });

  it("holds still when the shortest live interval is sparse", () => {
    const rows = [];
    let ts = 300_000;
    for (let i = 0; i < 200; i++) {
      rows.push({ timestampMs: ts });
      ts += i % 60 === 0 ? 40 : 41 + ((i * 7) % 8);
    }

    const seen = new Set();
    for (let length = 40; length <= 200; length++) {
      seen.add(resolveStableSpectrogramSampleMs(viewOf(rows.slice(0, length)), 40));
    }
    expect([...seen]).toEqual([40]);
  });

  it("still reports the nominal cadence when the producer runs consistently late", () => {
    // Under sustained load every interval in the lookback can sit at 45-48ms. Rounding to the
    // nearest point on an arbitrary 10ms grid then reports 50: a 25% error in the decimation stride,
    // invented at exactly the moment the machine is busiest.
    const rows = [];
    let ts = 500_000;
    for (let i = 0; i < 80; i++) {
      rows.push({ timestampMs: ts });
      ts += 45 + ((i * 7) % 4);
    }
    expect(resolveStableSpectrogramSampleMs(viewOf(rows), 40)).toBe(40);
  });

  it("does not flip the stride when a late stretch ends", () => {
    // The failure cadence matching exists to prevent: if the observed minimum straddles an
    // arbitrary grid boundary, the stride alternates between two values and every ridge re-binds on
    // the frames where it moves.
    const rows = [];
    let ts = 500_000;
    for (let i = 0; i < 80; i++) {
      rows.push({ timestampMs: ts });
      ts += i < 40 ? 46 : 41;
    }
    const seen = new Set();
    for (let length = 20; length <= rows.length; length++) {
      seen.add(resolveStableSpectrogramSampleMs(viewOf(rows.slice(0, length)), 40));
    }
    expect([...seen]).toEqual([40]);
  });

  it("does not undershoot the live cadence when a timestamp arrives 1ms early", () => {
    const rows = [];
    let ts = 500_000;
    for (let i = 0; i < 40; i++) {
      rows.push({ timestampMs: ts });
      ts += i === 30 ? 39 : 40;
    }
    expect(resolveStableSpectrogramSampleMs(viewOf(rows), 40)).toBe(40);
  });

  it("recognises file cadence when cumulative timestamp rounding produces 99ms intervals", () => {
    // File chunks contain floor(sampleRate / 10) frames and their cumulative media timestamp is
    // rounded to integer milliseconds. At rates such as 11025Hz that produces 99/100ms intervals,
    // even though the producer's nominal cadence is 100ms.
    const sampleRate = 11_025;
    const chunkFrames = Math.floor(sampleRate / 10);
    const rows = Array.from({ length: 40 }, (_, i) => ({
      timestampMs: Math.round((((i + 1) * chunkFrames) / sampleRate) * 1000),
    }));
    expect(resolveStableSpectrogramSampleMs(viewOf(rows), 40)).toBe(100);
  });

  it("follows a real cadence change, such as live to file mode", () => {
    expect(resolveStableSpectrogramSampleMs(frames(1000, 3000, 100), 40)).toBe(100);
  });

  // Capture gaps and stalls only ever make an interval longer, so the cadence must ignore them
  // rather than jump to the gap's width the way a single-interval reading does.
  it("ignores a capture gap at the newest end", () => {
    const rows = [];
    for (let ts = 1000; ts <= 1400; ts += 40) rows.push({ timestampMs: ts });
    rows.push({ timestampMs: 5000 });
    expect(resolveStableSpectrogramSampleMs(viewOf(rows), 999)).toBe(40);
    expect(resolveSpectrogramSampleMs(viewOf(rows), 999)).toBe(3600);
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
