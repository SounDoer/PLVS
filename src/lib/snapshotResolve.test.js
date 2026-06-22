import { describe, expect, it } from "vitest";
import { resolveSnapshot, resolveKeyedVisualIndex } from "./snapshotResolve.js";

/**
 * resolveSnapshot owns the two-timeline reconciliation that used to live inline in
 * useSnapshot: nearest-timestamp matching on the 10 Hz hist rings and the 25 Hz visual
 * rings, the no-timestamp cadence fallbacks, and entry picking. SVG path building and the
 * React freeze lifecycle stay in the hook.
 */

const liveAudio = { correlation: 0.9, peak: -1 };
const liveSpectrumData = { bands: [{ fCenter: 100 }], dbList: [-10] };

function baseView(overrides = {}) {
  return {
    selectedOffset: -1,
    sampleSec: 0.1,
    visualSampleSec: 0.04,
    histSourceList: [],
    audioList: [],
    corrList: [],
    spectrumDataList: [],
    channelMetadataList: [],
    visualSpectrum: [],
    visualVectorscope: [],
    liveAudio,
    liveSpectrumData,
    ...overrides,
  };
}

describe("resolveSnapshot", () => {
  it("passes through live data when no snapshot is selected", () => {
    const r = resolveSnapshot(baseView({ histSourceList: [{ timestampMs: 1000 }] }));
    expect(r.snapIdx).toBe(-1);
    expect(r.visualSnapIdx).toBe(-1);
    expect(r.displayAudio).toBe(liveAudio);
    expect(r.displaySpectrumData).toBe(liveSpectrumData);
    expect(r.correlation).toBe(0.9);
    expect(r.channelMetadata).toBe(null);
    expect(r.spectrumSnapDbList).toBe(null);
    expect(r.vectorSnapPairs).toBe(null);
    expect(r.hasHistoryData).toBe(true);
  });

  it("picks the hist-rate entry nearest the selected timestamp", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0,
        histSourceList: [{ timestampMs: 500 }, { timestampMs: 1000 }],
        audioList: [{ correlation: 0.1 }, { correlation: 0.7 }],
        corrList: [0.1, 0.7],
        spectrumDataList: [{ dbList: [-40] }, { dbList: [-20] }],
        channelMetadataList: [{ frequencyLabel: "L/R" }, { frequencyLabel: "C" }],
      })
    );
    // offset 0 → target = last timestamp (1000) → idx 1
    expect(r.snapIdx).toBe(1);
    expect(r.displayAudio).toEqual({ correlation: 0.7 });
    expect(r.displaySpectrumData).toEqual({ dbList: [-20] });
    expect(r.correlation).toBe(0.7);
    expect(r.channelMetadata).toEqual({ frequencyLabel: "C" });
  });

  it("matches hist and visual timelines independently by timestamp", () => {
    // hist at 10 Hz, visual at 25 Hz: the nearest visual index differs from the hist index.
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0.2,
        histSourceList: [{ timestampMs: 500 }, { timestampMs: 1000 }],
        audioList: [{ correlation: 0.1 }, { correlation: 0.2 }],
        corrList: [0.1, 0.2],
        spectrumDataList: [
          { bands: [{ fCenter: 100 }], dbList: [-40] },
          { bands: [{ fCenter: 100 }], dbList: [-20] },
        ],
        visualSpectrum: [500, 760, 830, 1000].map((timestampMs, i) => ({
          timestampMs,
          bands: [{ fCenter: 100 }],
          dbList: [-50 + i],
        })),
        visualVectorscope: [500, 760, 830, 1000].map((timestampMs, i) => ({
          timestampMs,
          pairs: [i, i],
        })),
      })
    );
    // target = 1000 - 0.2*1000 = 800 → nearest visual timestamp is 830 (idx 2)
    expect(r.visualSnapIdx).toBe(2);
    expect(r.spectrumSnapDbList).toEqual([-48]); // visualSpectrum[2].dbList
    expect(r.spectrumSnapCenters).toEqual([100]); // centers from hist-rate spectrumData (session-constant)
    expect(r.vectorSnapPairs).toEqual([2, 2]); // visualVectorscope[2].pairs
  });

  it("returns spectrumSnapDbListB from the matched visual snap", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0,
        histSourceList: [{ timestampMs: 1000 }],
        audioList: [{ correlation: 0.5 }],
        corrList: [0.5],
        spectrumDataList: [{ bands: [{ fCenter: 100 }], dbList: [-10], dbListB: [-12] }],
        channelMetadataList: [{}],
        visualSpectrum: [
          { timestampMs: 1000, bands: [{ fCenter: 100 }], dbList: [-10], dbListB: [-12] },
        ],
        visualVectorscope: [{ timestampMs: 1000, pairs: [] }],
      })
    );
    expect(r.spectrumSnapDbListB).toEqual([-12]);
  });

  it("falls back to live correlation when the snap correlation is non-finite", () => {
    const r = resolveSnapshot(
      baseView({
        selectedOffset: 0,
        histSourceList: [{ timestampMs: 1000 }],
        audioList: [{ correlation: 0.42 }],
        corrList: [-Infinity],
        spectrumDataList: [{ dbList: [-20] }],
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
        spectrumDataList: [{ dbList: [-1] }, { dbList: [-2] }, { dbList: [-3] }],
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
        spectrumDataList: [{}, {}, {}],
      })
    );
    // newest hist ts 3000 - 1s = 2000
    expect(r.targetTimestampMs).toBe(2000);
  });
});

describe("resolveKeyedVisualIndex", () => {
  const entries = [{ timestampMs: 1000 }, { timestampMs: 1040 }, { timestampMs: 1080 }];

  it("returns missing when the key has no history at all", () => {
    expect(resolveKeyedVisualIndex([], 1000, 40)).toEqual({ index: -1, missing: true });
    expect(resolveKeyedVisualIndex(undefined, 1000, 40)).toEqual({ index: -1, missing: true });
  });

  it("returns missing when the selected time predates the request's first entry", () => {
    // Request started at 1000; selecting 900 (beyond tolerance) means it did not exist yet.
    expect(resolveKeyedVisualIndex(entries, 900, 40)).toEqual({ index: -1, missing: true });
  });

  it("returns missing when the selected time is after the request's last entry", () => {
    // Request stopped at 1080; selecting 1140 (beyond tolerance) means it was inactive then.
    expect(resolveKeyedVisualIndex(entries, 1140, 40)).toEqual({ index: -1, missing: true });
  });

  it("tolerates boundary jitter just before the first entry", () => {
    // 980 is within one visual sample (40ms) of the 1000 start, so it resolves to entry 0.
    expect(resolveKeyedVisualIndex(entries, 980, 40)).toEqual({ index: 0, missing: false });
  });

  it("tolerates boundary jitter just after the last entry", () => {
    // 1110 is within one visual sample (40ms) of the 1080 end, so it resolves to entry 2.
    expect(resolveKeyedVisualIndex(entries, 1110, 40)).toEqual({ index: 2, missing: false });
  });

  it("picks the nearest entry to the target when within history", () => {
    expect(resolveKeyedVisualIndex(entries, 1050, 40)).toEqual({ index: 1, missing: false });
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
    expect(resolveKeyedVisualIndex(gapped, 3000, 40)).toEqual({ index: -1, missing: true });
    // A time near either active stretch still resolves.
    expect(resolveKeyedVisualIndex(gapped, 1020, 40)).toEqual({ index: 1, missing: false });
    expect(resolveKeyedVisualIndex(gapped, 5010, 40)).toEqual({ index: 2, missing: false });
  });

  it("returns the latest entry when the target is non-finite", () => {
    expect(resolveKeyedVisualIndex(entries, null, 40)).toEqual({ index: 2, missing: false });
  });
});
