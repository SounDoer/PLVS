import { describe, expect, it } from "vitest";
import {
  nearestTimestampIndex,
  resolveSnapshot,
  resolveKeyedVisualIndex,
} from "./snapshotResolve.js";

/**
 * resolveSnapshot owns the two-timeline reconciliation that used to live inline in
 * useSnapshot: nearest-timestamp matching on the 10 Hz hist rings and the 25 Hz visual
 * rings, the no-timestamp cadence fallbacks, and entry picking. SVG path building and the
 * React freeze lifecycle stay in the hook.
 */

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

const liveAudio = { correlation: 0.9, peak: -1 };

function linearNearestTimestampIndex(entries, targetMs) {
  if (
    entries.length === 0 ||
    !Number.isFinite(entries[0].timestampMs) ||
    !Number.isFinite(targetMs)
  ) {
    return -1;
  }
  let bestIdx = 0;
  let bestDistance = Math.abs(entries[0].timestampMs - targetMs);
  for (let i = 1; i < entries.length; i += 1) {
    const distance = Math.abs(entries[i].timestampMs - targetMs);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function baseView(overrides = {}) {
  return {
    selectedOffset: -1,
    sampleSec: 0.1,
    histSourceList: [],
    audioList: [],
    corrList: [],
    channelMetadataList: [],
    liveAudio,
    ...overrides,
  };
}

describe("nearestTimestampIndex", () => {
  it("supports arrays and chronological history views", () => {
    const rows = [{ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1300 }];
    expect(nearestTimestampIndex(rows, 1140)).toBe(1);
    expect(nearestTimestampIndex(viewOf(rows), 1140)).toBe(1);
  });

  it("returns -1 for empty history or a non-finite target", () => {
    expect(nearestTimestampIndex([], 1000)).toBe(-1);
    expect(nearestTimestampIndex(viewOf([]), 1000)).toBe(-1);
    expect(nearestTimestampIndex([{}], 1000)).toBe(-1);
    expect(nearestTimestampIndex(viewOf([{}]), 1000)).toBe(-1);
    expect(nearestTimestampIndex([{ timestampMs: 1000 }], NaN)).toBe(-1);
    expect(nearestTimestampIndex([{ timestampMs: 1000 }], Infinity)).toBe(-1);
  });

  it("resolves before-first, after-last, gaps, and midpoint ties", () => {
    const rows = [
      { timestampMs: 1000 },
      { timestampMs: 1040 },
      { timestampMs: 5000 },
      { timestampMs: 5040 },
    ];
    expect(nearestTimestampIndex(rows, 0)).toBe(0);
    expect(nearestTimestampIndex(rows, 9000)).toBe(3);
    expect(nearestTimestampIndex(rows, 3020)).toBe(2);
    expect(nearestTimestampIndex(rows, 1020)).toBe(1);
  });

  it("matches linear last-tie semantics for duplicate timestamps", () => {
    const rows = [
      { timestampMs: 1000 },
      { timestampMs: 1000 },
      { timestampMs: 1000 },
      { timestampMs: 1100 },
      { timestampMs: 1100 },
      { timestampMs: 1300 },
    ];
    expect(nearestTimestampIndex(rows, 1000)).toBe(2);
    expect(nearestTimestampIndex(rows, 1050)).toBe(4);
    expect(nearestTimestampIndex(rows, 1100)).toBe(4);
    expect(nearestTimestampIndex(rows, 1200)).toBe(5);
  });

  it("matches the previous linear implementation across deterministic randomized histories", () => {
    let state = 0x5eed1234;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let history = 0; history < 50; history += 1) {
      const rows = [];
      let timestampMs = Math.floor(random() * 1000);
      const length = 1 + Math.floor(random() * 200);
      for (let i = 0; i < length; i += 1) {
        timestampMs += random() < 0.25 ? 0 : 1 + Math.floor(random() * 500);
        rows.push({ timestampMs });
      }

      const targets = [
        rows[0].timestampMs - 1000,
        rows.at(-1).timestampMs + 1000,
        ...Array.from({ length: 100 }, () => {
          const span = rows.at(-1).timestampMs - rows[0].timestampMs + 2000;
          return rows[0].timestampMs - 1000 + random() * span;
        }),
      ];
      for (const target of targets) {
        const expected = linearNearestTimestampIndex(rows, target);
        expect(nearestTimestampIndex(rows, target)).toBe(expected);
        expect(nearestTimestampIndex(viewOf(rows), target)).toBe(expected);
      }
    }
  });

  it("reads a 360,000-row lazy view only logarithmically", () => {
    let reads = 0;
    const length = 360_000;
    const view = {
      length,
      timestampAt(index) {
        reads += 1;
        return index * 40;
      },
      rowAt(index) {
        return { timestampMs: index * 40 };
      },
    };

    expect(nearestTimestampIndex(view, 7_654_321)).toBe(
      linearNearestTimestampIndex(
        [{ timestampMs: 7_654_320 }, { timestampMs: 7_654_360 }],
        7_654_321
      ) + 191_358
    );
    expect(reads).toBeLessThanOrEqual(30);
  });
});

describe("resolveSnapshot", () => {
  it("passes through live data when no snapshot is selected", () => {
    const r = resolveSnapshot(baseView({ histSourceList: [{ timestampMs: 1000 }] }));
    expect(r.snapIdx).toBe(-1);
    expect(r.displayAudio).toBe(liveAudio);
    expect(r.correlation).toBe(0.9);
    expect(r.channelMetadata).toBe(null);
    expect(r.hasHistoryData).toBe(true);
  });

  it("picks the hist-rate entry nearest the selected timestamp", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0,
        histSourceList: [{ timestampMs: 500 }, { timestampMs: 1000 }],
        audioList: [{ correlation: 0.1 }, { correlation: 0.7 }],
        corrList: [0.1, 0.7],
        channelMetadataList: [{ frequencyLabel: "L/R" }, { frequencyLabel: "C" }],
      })
    );
    // offset 0 → target = last timestamp (1000) → idx 1
    expect(r.snapIdx).toBe(1);
    expect(r.displayAudio).toEqual({ correlation: 0.7 });
    expect(r.correlation).toBe(0.7);
    expect(r.channelMetadata).toEqual({ frequencyLabel: "C" });
  });

  it("falls back to live correlation when the snap correlation is non-finite", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0,
        histSourceList: [{ timestampMs: 1000 }],
        audioList: [{ correlation: 0.42 }],
        corrList: [-Infinity],
      })
    );
    expect(r.correlation).toBe(0.42); // displayAudio.correlation, not the -Infinity snap
  });

  it("uses cadence-based fallback indices when entries have no timestamps", () => {
    // No timestampMs → fall back to selectedOffset / sampleSec stepping.
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0.2,
        sampleSec: 0.1,
        histSourceList: [{}, {}, {}],
        audioList: [{ correlation: 1 }, { correlation: 2 }, { correlation: 3 }],
        corrList: [1, 2, 3],
      })
    );
    // steps = round(0.2 / 0.1) = 2 → snapIdx = max(0, 3 - 1 - 2) = 0
    expect(r.snapIdx).toBe(0);
    expect(r.displayAudio).toEqual({ correlation: 1 });
  });

  it("exposes the resolved target timestamp for per-key lookups", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 1,
        histSourceList: [{ timestampMs: 1000 }, { timestampMs: 2000 }, { timestampMs: 3000 }],
        audioList: [{}, {}, {}],
        corrList: [0, 0, 0],
      })
    );
    // newest hist ts 3000 - 1s = 2000
    expect(r.targetTimestampMs).toBe(2000);
  });

  it("returns the selected target timestamp for UI display", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 1,
        histSourceList: [{ timestampMs: 10_000 }, { timestampMs: 20_000 }, { timestampMs: 30_000 }],
        audioList: [{}, {}, {}],
        corrList: [0, 0, 0],
        spectrumDataList: [{}, {}, {}],
      })
    );
    // newest hist ts 30_000 - 1s = 29_000
    expect(r.targetTimestampMs).toBe(29_000);
  });

  it("clamps a too-old selected target to the earliest shared history sample", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 5,
        histSourceList: [{ timestampMs: 10_000 }, { timestampMs: 10_100 }],
        audioList: [{ correlation: 0.1 }, { correlation: 0.2 }],
        corrList: [0.1, 0.2],
      })
    );

    expect(r.targetTimestampMs).toBe(10_000);
    expect(r.snapIdx).toBe(0);
    expect(r.displayAudio).toEqual({ correlation: 0.1 });
  });
});

describe("resolveKeyedVisualIndex", () => {
  const entries = [{ timestampMs: 1000 }, { timestampMs: 1040 }, { timestampMs: 1080 }];

  it("returns missing when the key has no history at all", () => {
    expect(resolveKeyedVisualIndex(viewOf([]), 1000, 40)).toEqual({ index: -1, missing: true });
    expect(resolveKeyedVisualIndex(undefined, 1000, 40)).toEqual({ index: -1, missing: true });
  });

  it("returns missing when the selected time predates the request's first entry", () => {
    // Request started at 1000; selecting 900 (beyond tolerance) means it did not exist yet.
    expect(resolveKeyedVisualIndex(viewOf(entries), 900, 40)).toEqual({ index: -1, missing: true });
  });

  it("returns missing when the selected time is after the request's last entry", () => {
    // Request stopped at 1080; selecting 1140 (beyond tolerance) means it was inactive then.
    expect(resolveKeyedVisualIndex(viewOf(entries), 1140, 40)).toEqual({
      index: -1,
      missing: true,
    });
  });

  it("tolerates boundary jitter just before the first entry", () => {
    // 980 is within one visual sample (40ms) of the 1000 start, so it resolves to entry 0.
    expect(resolveKeyedVisualIndex(viewOf(entries), 980, 40)).toEqual({ index: 0, missing: false });
  });

  it("tolerates boundary jitter just after the last entry", () => {
    // 1110 is within one visual sample (40ms) of the 1080 end, so it resolves to entry 2.
    expect(resolveKeyedVisualIndex(viewOf(entries), 1110, 40)).toEqual({
      index: 2,
      missing: false,
    });
  });

  it("picks the nearest entry to the target when within history", () => {
    expect(resolveKeyedVisualIndex(viewOf(entries), 1050, 40)).toEqual({
      index: 1,
      missing: false,
    });
  });

  it("returns missing when the selected time lands in an interior gap", () => {
    // The view was active around 1000 then again around 5000 (the user switched away and back).
    // 3000 sits inside the gap and is far from any entry, so the view had no data then.
    const gapped = [
      { timestampMs: 1000 },
      { timestampMs: 1040 },
      { timestampMs: 5000 },
      { timestampMs: 5040 },
    ];
    expect(resolveKeyedVisualIndex(viewOf(gapped), 3000, 40)).toEqual({ index: -1, missing: true });
    // A time near either active stretch still resolves.
    expect(resolveKeyedVisualIndex(viewOf(gapped), 1020, 40)).toEqual({ index: 1, missing: false });
    expect(resolveKeyedVisualIndex(viewOf(gapped), 5010, 40)).toEqual({ index: 2, missing: false });
  });

  it("returns the latest entry when the target is non-finite", () => {
    expect(resolveKeyedVisualIndex(viewOf(entries), null, 40)).toEqual({
      index: 2,
      missing: false,
    });
  });
});
