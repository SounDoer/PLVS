import { describe, expect, it } from "vitest";
import { buildTauriFrameApply } from "./tauriFrameApply.js";

describe("buildTauriFrameApply", () => {
  it("updates loudness maxima from the frame payload", () => {
    let audioState = {
      peakDb: [],
      peakHoldDb: [],
      samplePeakMaxL: -Infinity,
      samplePeakMaxR: -Infinity,
      vectorscopePairX: 0,
      vectorscopePairY: 1,
    };
    const setAudio = (updater) => {
      audioState = updater(audioState);
    };
    const { applyFrame } = buildTauriFrameApply({
      histMaxSamples: 10,
      visualMaxSamples: 10,
      intake: {
        pushFrame() {},
        pushVisualHistRow() {},
      },
      frameRef: { current: 0 },
      selectedOffsetRef: { current: -1 },
      defaultSampleRateRef: { current: 48000 },
      setAudio,
      setSpectrumPath() {},
      setSpectrumPeakPath() {},
      setVectorPath() {},
      setHistoryPathM() {},
      setHistoryPathST() {},
    });

    applyFrame({
      peakDb: [],
      peakHoldDb: [],
      lufsMomentary: -18,
      lufsShortTerm: -20,
      lufsMMax: -12.3,
      lufsStMax: -14.5,
      integrated: -23,
      lra: 3.2,
      truePeakMaxDbtp: -1,
      truePeakL: -1.2,
      truePeakR: -1.4,
      sampleLDb: -3,
      sampleRDb: -4,
      correlation: 0.5,
    });

    expect(audioState.mMax).toBe(-12.3);
    expect(audioState.stMax).toBe(-14.5);
  });
});
