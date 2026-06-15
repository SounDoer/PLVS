import { describe, it, expect } from "vitest";
import { resolveSnapshot } from "./snapshotResolve.js";

describe("snapshotResolve", () => {
  it("returns spectrumSnapDbListB from the visual snap", () => {
    const out = resolveSnapshot({
      selectedOffset: 0,
      sampleSec: 0.1,
      visualSampleSec: 0.04,
      histSourceList: [{ timestampMs: 1000 }],
      audioList: [{ correlation: 0.5 }],
      corrList: [0.5],
      spectrumDataList: [{ bands: [{ fCenter: 100 }], dbList: [-10], dbListB: [-12] }],
      channelMetadataList: [{}],
      visualSpectrum: [{ timestampMs: 1000, dbList: [-10], dbListB: [-12] }],
      visualVectorscope: [{ timestampMs: 1000, pairs: [] }],
      liveAudio: {},
      liveSpectrumData: { bands: [], dbList: [], dbListB: [] },
    });
    expect(out.spectrumSnapDbListB).toEqual([-12]);
  });
});
