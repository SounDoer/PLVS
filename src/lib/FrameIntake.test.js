import { describe, expect, it } from "vitest";
import { FrameIntake, buildSpectrumDataSnapshot } from "./FrameIntake.js";

const HIST_MAX = 5;
const SR = 48000;

function makeRow(overrides = {}) {
  return {
    lufsMomentary: -23,
    lufsShortTerm: -24,
    integrated: -25,
    lra: 4,
    truePeakL: -1,
    truePeakR: -1.5,
    truePeakMaxDbtp: -1,
    sampleLDb: -3,
    sampleRDb: -3.5,
    samplePeakMaxL: -3,
    samplePeakMaxR: -3.5,
    correlation: 0.9,
    vectorscopePath: "M 10 10",
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    spectrumPath: "M 0 130",
    spectrumPeakPath: "",
    spectrumBandCentersHz: [],
    spectrumSmoothDb: [],
    ...overrides,
  };
}

function makeFrame(overrides = {}) {
  return {
    peakDb: [-6, -6],
    peakHoldDb: [-6, -6],
    lufsMomentary: -23,
    lufsShortTerm: -24,
    integrated: -25,
    lra: 4,
    truePeakL: -1,
    truePeakR: -1.5,
    truePeakMaxDbtp: -1,
    sampleLDb: -3,
    sampleRDb: -3.5,
    correlation: 0.9,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    spectrumPath: "M 0 130",
    spectrumPeakPath: "",
    spectrumBandCentersHz: [],
    spectrumSmoothDb: [],
    loudnessHistTick: null,
    ...overrides,
  };
}

describe("FrameIntake", () => {
  it("starts empty", () => {
    const intake = new FrameIntake();
    expect(intake.getLoudnessHistory()).toHaveLength(0);
    expect(intake.getAudioSnap()).toHaveLength(0);
    expect(intake.getCorrSnap()).toHaveLength(0);
    expect(intake.getSpectrumDataSnap()).toHaveLength(0);
    expect(intake.getSpectrumData()).toBeNull();
  });

  it("pushHistRow adds to the hist-rate rings", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getAudioSnap()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
    expect(intake.getSpectrumDataSnap()).toHaveLength(1);
  });

  it("preserves history and visual timestamps for cross-rate alignment", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ timestampMs: 1200 }), HIST_MAX, SR);
    intake.pushVisualHistRow(
      {
        timestampMs: 1240,
        waveformMin: [-0.5, -0.3],
        waveformMax: [0.5, 0.3],
        spectrumSmoothDb: [-20, -30, -40],
        vectorscopePairs: [],
        correlation: 0.8,
      },
      10
    );

    expect(intake.getLoudnessHistory()[0].timestampMs).toBe(1200);
    expect(intake.getVisualWaveformHist().at(0).timestampMs).toBe(1240);
    expect(intake.getVisualSpectrumHist().at(0).timestampMs).toBe(1240);
  });

  it("writes a pending frequency marker on the next history row", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({
      frequencyLabel: "C",
      vectorscopePairLabel: "L/R",
    });
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getFrequencyChannelMarkers()).toEqual([
      { type: "frequencyChannelChange", from: "L/R", to: "C" },
    ]);
    expect(intake.getChannelMetadataSnap()).toEqual([
      { frequencyLabel: "C", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("keeps frequency markers and metadata aligned with loudness history", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({
      frequencyLabel: "L/R",
      vectorscopePairLabel: "L/R",
    });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getLoudnessHistory()).toHaveLength(2);
    expect(intake.getFrequencyChannelMarkers()).toEqual([null, null]);
    expect(intake.getChannelMetadataSnap()).toEqual([
      { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
      { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("preserves existing channel metadata on partial updates", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({ frequencyLabel: "C", vectorscopePairLabel: "L/R" });
    intake.setCurrentChannelMetadata({ frequencyLabel: "LFE" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getChannelMetadataSnap()).toEqual([
      { frequencyLabel: "LFE", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("keeps defined empty channel metadata labels", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({ frequencyLabel: "", vectorscopePairLabel: "" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getChannelMetadataSnap()).toEqual([
      { frequencyLabel: "", vectorscopePairLabel: "" },
    ]);
  });

  it("writes a pending frequency marker once", () => {
    const intake = new FrameIntake();
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getFrequencyChannelMarkers()).toEqual([
      { type: "frequencyChannelChange", from: "L/R", to: "C" },
      null,
    ]);
  });

  it("reset clears frequency markers and channel metadata history", () => {
    const intake = new FrameIntake();
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    intake.reset();

    expect(intake.getFrequencyChannelMarkers()).toEqual([]);
    expect(intake.getChannelMetadataSnap()).toEqual([]);
  });

  it("pushHistRow records loudness values correctly", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ lufsMomentary: -18, lufsShortTerm: -20 }), HIST_MAX, SR);
    const [entry] = intake.getLoudnessHistory();
    expect(entry.m).toBe(-18);
    expect(entry.st).toBe(-20);
  });

  it("pushHistRow clamps ring to histMaxSamples", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < HIST_MAX + 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX, SR);
    }
    expect(intake.getLoudnessHistory()).toHaveLength(HIST_MAX);
    expect(intake.getAudioSnap()).toHaveLength(HIST_MAX);
    expect(intake.getCorrSnap()).toHaveLength(HIST_MAX);
    expect(intake.getSpectrumDataSnap()).toHaveLength(HIST_MAX);
  });

  it("pushHistRow treats non-finite as -Infinity", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ lufsMomentary: NaN, correlation: undefined }), HIST_MAX, SR);
    expect(intake.getLoudnessHistory()[0].m).toBe(-Infinity);
    expect(intake.getCorrSnap()[0]).toBe(-Infinity);
  });

  it("pushFrame without histTick updates spectrum only", () => {
    const intake = new FrameIntake();
    intake.pushFrame(makeFrame(), HIST_MAX, SR);
    expect(intake.getLoudnessHistory()).toHaveLength(0);
    expect(intake.getSpectrumData()).not.toBeNull();
  });

  it("pushFrame with histTick pushes to all rings", () => {
    const intake = new FrameIntake();
    const row = makeRow();
    intake.pushFrame(makeFrame({ loudnessHistTick: row }), HIST_MAX, SR);
    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
  });

  it("pushFrame with freezeSpectrum=true does not update spectrum data", () => {
    const intake = new FrameIntake();
    intake.pushFrame(makeFrame(), HIST_MAX, SR, true);
    expect(intake.getSpectrumData()).toBeNull();
  });

  it("finalizeFromRow sets live spectrum data", () => {
    const intake = new FrameIntake();
    intake.finalizeFromRow(makeRow(), SR);
    expect(intake.getSpectrumData()).not.toBeNull();
    expect(intake.getSpectrumData()).toHaveProperty("bands");
    expect(intake.getSpectrumData()).toHaveProperty("dbList");
  });

  it("reset clears all rings and spectrum data", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX, SR);
    }
    intake.pushFrame(makeFrame(), HIST_MAX, SR);
    intake.reset();
    expect(intake.getLoudnessHistory()).toHaveLength(0);
    expect(intake.getAudioSnap()).toHaveLength(0);
    expect(intake.getCorrSnap()).toHaveLength(0);
    expect(intake.getSpectrumDataSnap()).toHaveLength(0);
    expect(intake.getSpectrumData()).toBeNull();
  });

  it("audioSnap has expected shape", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      makeRow({ lufsMomentary: -20, correlation: 0.5, vectorscopePairX: 2, vectorscopePairY: 3 }),
      HIST_MAX,
      SR
    );
    const snap = intake.getAudioSnap()[0];
    expect(snap.momentary).toBe(-20);
    expect(snap.correlation).toBe(0.5);
    expect(snap.vectorscopePairX).toBe(2);
    expect(snap.vectorscopePairY).toBe(3);
  });

  it("pushVisualHistRow stores entry in visual ring buffers", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [-0.5, -0.3],
      waveformMax: [0.5, 0.3],
      spectrumSmoothDb: [-20, -30, -40],
      vectorscopePairs: new Array(400).fill(0.1),
      correlation: 0.8,
    };
    intake.pushVisualHistRow(row, 10);
    expect(intake.getVisualWaveformHist().length).toBe(1);
    expect(intake.getVisualSpectrumHist().length).toBe(1);
    expect(intake.getVisualVectorscopeHist().length).toBe(1);
    expect(intake.getVisualCorrHist().length).toBe(1);
    expect(intake.getVisualWaveformHist().at(0)).toEqual({
      waveformMin: [-0.5, -0.3],
      waveformMax: [0.5, 0.3],
    });
  });

  it("pushVisualHistRow stores request-keyed visual history per key", () => {
    const intake = new FrameIntake();
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: {
          "spectrum:single:0:combined": { bandCentersHz: [100, 200], smoothDb: [-20, -30] },
        },
        vectorscopeByKey: {
          "vectorscope:pair:0:1": { pairs: [0.1, 0.2], correlation: 0.5 },
        },
      },
      10
    );

    const specRing = intake.getVisualSpectrumHistByKey("spectrum:single:0:combined");
    expect(specRing.length).toBe(1);
    expect(specRing.at(0).dbList).toBeInstanceOf(Float32Array);
    expect(Array.from(specRing.at(0).dbList)).toEqual([-20, -30]);
    expect(intake.getVisualVectorscopeHistByKey("vectorscope:pair:0:1").length).toBe(1);
    // A key never seen has no ring.
    expect(intake.getVisualSpectrumHistByKey("spectrum:single:1:combined")).toBeNull();
  });

  it("recreates a request-keyed spectrum slab when the band grid changes", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: {
          [key]: { bandCentersHz: [100, 200], smoothDb: [-10, -20] },
        },
      },
      10
    );

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1040,
        spectrumByKey: {
          [key]: { bandCentersHz: [100, 200, 400], smoothDb: [-30, -40, -50] },
        },
      },
      10
    );

    const history = intake.getVisualSpectrumHistByKey(key);
    expect(history.length).toBe(1);
    expect(history.at(0).timestampMs).toBe(1040);
    expect(Array.from(history.at(0).dbList)).toEqual([-30, -40, -50]);
  });

  it("clear releases request-keyed spectrum slabs and spectrogram arrays", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
      spectrumByKey: { [key]: { bandCentersHz: [100], smoothDb: [-10] } },
    };

    intake.pushVisualHistRow(row, 10);
    expect(intake.getVisualSpectrumHistByKey(key)).not.toBeNull();
    expect(intake.getSpectrogramSnapArrayForKey(key).length).toBe(1);

    intake.reset();

    expect(intake.getVisualSpectrumHistByKey(key)).toBeNull();
    expect(intake.getSpectrogramSnapArrayForKey(key)).toEqual([]);
  });

  it("stores request-keyed secondary spectrum curves in typed row views", () => {
    const intake = new FrameIntake();
    const key = "spectrum:pair:0:1:lr";
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
      spectrumByKey: {
        [key]: {
          bandCentersHz: [100, 200],
          smoothDb: [-10, -20],
          smoothDbB: [-30, -40],
        },
      },
    };

    intake.pushVisualHistRow(row, 10);
    const snap = intake.getVisualSpectrumHistByKey(key).at(0);

    expect(snap.dbList).toBeInstanceOf(Float32Array);
    expect(snap.dbListB).toBeInstanceOf(Float32Array);
    expect(Array.from(snap.dbListB)).toEqual([-30, -40]);
  });

  it("freezes request-keyed spectrum snapshot rows against later slab overwrites", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-10, -20] } },
      },
      2
    );
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1040,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-30, -40] } },
      },
      2
    );

    const frozen = intake.snapshotVisualSpectrumByKey()[key];

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1080,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-50, -60] } },
      },
      2
    );

    expect(Array.from(frozen[0].dbList)).toEqual([-10, -20]);
    expect(Array.from(intake.getVisualSpectrumHistByKey(key).at(1).dbList)).toEqual([-50, -60]);
  });

  it("retains an inactive request key's history when later ticks omit it (no backfill)", () => {
    const intake = new FrameIntake();
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    const keyA = "spectrum:single:0:combined";
    const keyB = "spectrum:single:1:combined";

    // t=1000 only A is active.
    intake.pushVisualHistRow(
      { ...baseRow, timestampMs: 1000, spectrumByKey: { [keyA]: { smoothDb: [-10] } } },
      10
    );
    // t=1040 the panel switched to B; A is now inactive, B starts collecting here (no backfill).
    intake.pushVisualHistRow(
      { ...baseRow, timestampMs: 1040, spectrumByKey: { [keyB]: { smoothDb: [-20] } } },
      10
    );

    // A keeps its single retained entry; B only has the one from its start time.
    expect(intake.getVisualSpectrumHistByKey(keyA).length).toBe(1);
    expect(intake.getVisualSpectrumHistByKey(keyA).at(0).timestampMs).toBe(1000);
    expect(intake.getVisualSpectrumHistByKey(keyB).length).toBe(1);
    expect(intake.getVisualSpectrumHistByKey(keyB).at(0).timestampMs).toBe(1040);

    intake.reset();
    expect(intake.getVisualSpectrumHistByKey(keyA)).toBeNull();
    expect(intake.getVisualSpectrumHistByKey(keyB)).toBeNull();
  });

  it("per-key spectrogram bands fall back to live frame centers when the tick omits them", () => {
    const intake = new FrameIntake();
    const centers = [100, 200, 400, 800];
    const key = "spectrum:single:0:combined";
    // The live frame carries the constant grid centers...
    intake.pushFrame(
      makeFrame({ spectrumBandCentersHz: centers, spectrumSmoothDb: [-30, -40, -50, -60] }),
      HIST_MAX,
      SR
    );
    // ...but the ~25 Hz visual tick omits them to save bandwidth.
    intake.pushVisualHistRow(
      {
        waveformMin: [0],
        waveformMax: [0],
        spectrumSmoothDb: [],
        vectorscopePairs: [],
        correlation: 0,
        spectrumByKey: { [key]: { smoothDb: [-30, -40, -50, -60] } },
      },
      10
    );
    const snap = intake.getSpectrogramSnapArrayForKey(key);
    expect(snap[0].bands.length).toBe(centers.length);
    expect(snap[0].bands[0].fCenter).toBeCloseTo(centers[0]);
  });

  it("uses payload grid frequencies, not recomputed RTA bands", () => {
    const centers = Array.from(
      { length: 958 },
      (_, i) => 20 * Math.pow(2, (i / 957) * Math.log2(1000))
    );
    const dbList = centers.map(() => -50);
    const out = buildSpectrumDataSnapshot(
      { spectrumBandCentersHz: centers, spectrumSmoothDb: dbList },
      { defaultSampleRate: 48000 }
    );
    expect(out.bands.length).toBe(centers.length);
    expect(out.bands[0].fCenter).toBeCloseTo(centers[0]);
    expect(out.dbList.length).toBe(dbList.length);
  });

  it("visual ring evicts oldest when over capacity", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    for (let i = 0; i < 5; i++) intake.pushVisualHistRow(row, 3);
    expect(intake.getVisualWaveformHist().length).toBe(3);
  });

  it("reuses constant visual arrays instead of cloning silent rows", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [0, 0],
      waveformMax: [0, 0],
      spectrumSmoothDb: [-100, -100, -100],
      vectorscopePairs: [0, 0, 0, 0],
      correlation: 0,
    };

    intake.pushVisualHistRow(row, 10);
    intake.pushVisualHistRow(row, 10);

    expect(intake.getVisualWaveformHist().at(0).waveformMin).toBe(
      intake.getVisualWaveformHist().at(1).waveformMin
    );
    expect(intake.getVisualSpectrumHist().at(0).dbList).toBe(
      intake.getVisualSpectrumHist().at(1).dbList
    );
    expect(intake.getVisualVectorscopeHist().at(0).pairs).toBe(
      intake.getVisualVectorscopeHist().at(1).pairs
    );
  });

  it("does not reuse non-constant visual arrays", () => {
    const intake = new FrameIntake();
    intake.pushVisualHistRow(
      { waveformMin: [0, -0.1], waveformMax: [0, 0.1], spectrumSmoothDb: [-90, -80] },
      10
    );
    intake.pushVisualHistRow(
      { waveformMin: [0, -0.1], waveformMax: [0, 0.1], spectrumSmoothDb: [-90, -80] },
      10
    );

    expect(intake.getVisualSpectrumHist().at(0).dbList).not.toBe(
      intake.getVisualSpectrumHist().at(1).dbList
    );
  });

  it("pushHistRow stores waveform sub-pairs as a Float32Array on the row", () => {
    const intake = new FrameIntake();
    const pairs = new Float32Array([-0.5, 0.5, -0.3, 0.3]);
    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubCount).toBe(1);
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(Array.from(row.waveformSubPairs)).toEqual(Array.from(pairs));
  });

  it("pushHistRow defaults sub-pairs to an empty Float32Array when absent", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(row.waveformSubPairs).toHaveLength(0);
    expect(row.waveformSubCount).toBe(0);
  });

  it("reuses constant waveform sub-pair arrays", () => {
    const intake = new FrameIntake();
    const pairs = new Float32Array([0, 0, 0, 0]);

    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);
    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);

    expect(intake.getLoudnessHistory()[0].waveformSubPairs).toBe(
      intake.getLoudnessHistory()[1].waveformSubPairs
    );
  });
});

describe("secondary curve in spectrum data", () => {
  it("includes dbListB when present", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100, 1000],
      spectrumSmoothDb: [-10, -20],
      spectrumSmoothDbB: [-15, -25],
    });
    expect(data.dbListB).toEqual([-15, -25]);
  });
  it("defaults dbListB to empty when absent", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100],
      spectrumSmoothDb: [-10],
    });
    expect(data.dbListB).toEqual([]);
  });
});
