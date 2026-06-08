import { describe, expect, it } from "vitest";
import { FrameIntake } from "./FrameIntake.js";

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
    expect(intake.getVectorSnap()).toHaveLength(0);
    expect(intake.getSpectrumSnap()).toHaveLength(0);
    expect(intake.getSpectrumDataSnap()).toHaveLength(0);
    expect(intake.getSpectrumData()).toBeNull();
  });

  it("pushHistRow adds to all six rings", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getAudioSnap()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
    expect(intake.getVectorSnap()).toHaveLength(1);
    expect(intake.getSpectrumSnap()).toHaveLength(1);
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
    expect(intake.getVectorSnap()).toHaveLength(HIST_MAX);
    expect(intake.getSpectrumSnap()).toHaveLength(HIST_MAX);
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
    expect(intake.getVectorSnap()).toHaveLength(0);
    expect(intake.getSpectrumSnap()).toHaveLength(0);
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

  it("vectorSnap stores vectorscope path strings", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ vectorscopePath: "M 65 65 L 70 70" }), HIST_MAX, SR);
    expect(intake.getVectorSnap()[0]).toBe("M 65 65 L 70 70");
  });

  it("spectrumSnap stores spectrum path strings", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ spectrumPath: "M 0 100 L 10 90" }), HIST_MAX, SR);
    expect(intake.getSpectrumSnap()[0]).toBe("M 0 100 L 10 90");
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
});
