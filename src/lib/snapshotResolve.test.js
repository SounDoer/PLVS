import { describe, expect, it } from "vitest";
import { resolveSnapshot } from "./snapshotResolve.js";

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
});
