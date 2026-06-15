import { describe, expect, it, vi } from "vitest";
import { buildTauriFrameApply } from "./tauriFrameApply.js";

function makeOptions(overrides = {}) {
  return {
    histMaxSamples: 10,
    visualMaxSamples: 10,
    intake: {
      pushFrame() {},
      pushVisualHistRow() {},
    },
    frameRef: { current: 0 },
    selectedOffsetRef: { current: -1 },
    defaultSampleRateRef: { current: 48000 },
    setAudio() {},
    setSpectrumPath() {},
    setSpectrumPeakPath() {},
    setSpectrumPathB() {},
    setVectorPath() {},
    setHistoryPathM() {},
    setHistoryPathST() {},
    ...overrides,
  };
}

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
    const { applyFrame } = buildTauriFrameApply(makeOptions({ setAudio }));

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

  it("calls setSpectrumPathB with the B path from the frame", () => {
    const setSpectrumPathB = vi.fn();
    // frameRef starts at 1 so first applyFrame increments to 2 (even → shouldPaintUi = true)
    const { applyFrame } = buildTauriFrameApply(
      makeOptions({ setSpectrumPathB, frameRef: { current: 1 } })
    );
    applyFrame({ spectrumPathB: "abc" });
    expect(setSpectrumPathB).toHaveBeenCalledWith("abc");
  });
});
