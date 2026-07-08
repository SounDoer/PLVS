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
    defaultSampleRateRef: { current: 48000 },
    setAudio() {},
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

  it("acks the latest seq every 6th frame so the bridge can bound its backlog", () => {
    const ackFrames = vi.fn();
    const { applyFrame } = buildTauriFrameApply(makeOptions({ ackFrames }));
    for (let i = 1; i <= 12; i++) {
      applyFrame({ peakDb: [], peakHoldDb: [], seq: i });
    }
    // frameRef hits 6 and 12 → two acks, each carrying that frame's seq.
    expect(ackFrames.mock.calls).toEqual([[6], [12]]);
  });

  it("does not ack when the frame carries no seq", () => {
    const ackFrames = vi.fn();
    const { applyFrame } = buildTauriFrameApply(makeOptions({ ackFrames }));
    for (let i = 1; i <= 6; i++) {
      applyFrame({ peakDb: [], peakHoldDb: [] });
    }
    expect(ackFrames).not.toHaveBeenCalled();
  });

  it("freezes the live display when shouldDriveDisplay is false but still ingests and acks", () => {
    const setAudio = vi.fn();
    const ackFrames = vi.fn();
    const pushFrame = vi.fn();
    const { applyFrame } = buildTauriFrameApply(
      makeOptions({
        setAudio,
        ackFrames,
        intake: { pushFrame, pushVisualHistRow() {} },
        shouldDriveDisplay: () => false,
      })
    );

    for (let i = 1; i <= 6; i++) {
      applyFrame({ peakDb: [], peakHoldDb: [], seq: i });
    }

    // Display is frozen for the inactive (background) session...
    expect(setAudio).not.toHaveBeenCalled();
    // ...but the analyzing session's intake keeps filling and the bridge keeps draining.
    expect(pushFrame).toHaveBeenCalledTimes(6);
    expect(ackFrames).toHaveBeenCalledWith(6);
  });

  it("propagates per-key spectrum/vectorscope live results into audio state", () => {
    let audioState = { spectrumResultsByKey: {}, vectorscopeResultsByKey: {} };
    const setAudio = (updater) => {
      audioState = updater(audioState);
    };
    const { applyFrame } = buildTauriFrameApply(makeOptions({ setAudio }));
    const spectrumResultsByKey = { "spectrum:pair:0:1:combined": { path: "p" } };
    const vectorscopeResultsByKey = { "vectorscope:pair:0:1": { path: "v" } };
    applyFrame({ peakDb: [], peakHoldDb: [], spectrumResultsByKey, vectorscopeResultsByKey });
    expect(audioState.spectrumResultsByKey).toBe(spectrumResultsByKey);
    expect(audioState.vectorscopeResultsByKey).toBe(vectorscopeResultsByKey);
  });
});
