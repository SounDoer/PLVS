import { describe, expect, it, vi } from "vitest";
import * as tauriFrameApply from "./tauriFrameApply.js";

const { buildTauriFrameApply } = tauriFrameApply;

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
    latestAudioRef: {
      current: {
        peakDb: [],
        rmsDb: [],
        peakHoldDb: [],
        samplePeakMaxL: -Infinity,
        samplePeakMaxR: -Infinity,
      },
    },
    setAudio() {},
    ...overrides,
  };
}

describe("buildTauriFrameApply", () => {
  it("exports the frame reducer as a pure function", () => {
    expect(tauriFrameApply.reduceMeterAudioFrame).toEqual(expect.any(Function));
    const previous = {
      peakDb: [-30],
      rmsDb: [-32],
      peakHoldDb: [-20],
      samplePeakMaxL: -8,
      samplePeakMaxR: -9,
      spectrumResultsByKey: { old: true },
      vectorscopeResultsByKey: { old: true },
    };

    const next = tauriFrameApply.reduceMeterAudioFrame(previous, {
      peakDb: [-12],
      lufsMomentary: -18,
      lufsMMax: -10,
      lufsStMax: -11,
      truePeakMaxDbtp: -1,
      sampleLDb: -3,
      sampleRDb: -4,
      spectrumResultsByKey: { next: true },
      vectorscopeResultsByKey: { next: true },
    });

    expect(previous).toEqual({
      peakDb: [-30],
      rmsDb: [-32],
      peakHoldDb: [-20],
      samplePeakMaxL: -8,
      samplePeakMaxR: -9,
      spectrumResultsByKey: { old: true },
      vectorscopeResultsByKey: { old: true },
    });
    expect(next).toMatchObject({
      peakDb: [-12],
      rmsDb: [-32],
      peakHoldDb: [-20],
      momentary: -18,
      mMax: -10,
      stMax: -11,
      tpMax: -1,
      samplePeakMaxL: -3,
      samplePeakMaxR: -4,
      spectrumResultsByKey: { next: true },
      vectorscopeResultsByKey: { next: true },
    });
  });

  it("updates loudness maxima from the frame payload", () => {
    let audioState = {
      peakDb: [],
      peakHoldDb: [],
      samplePeakMaxL: -Infinity,
      samplePeakMaxR: -Infinity,
      vectorscopePairX: 0,
      vectorscopePairY: 1,
    };
    const setAudio = (next) => {
      audioState = next;
    };
    const latestAudioRef = { current: audioState };
    const { applyFrame } = buildTauriFrameApply(makeOptions({ setAudio, latestAudioRef }));

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
    expect(latestAudioRef.current).toBe(audioState);
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
    const latest = { marker: "active-source" };
    const latestAudioRef = { current: latest };
    const { applyFrame } = buildTauriFrameApply(
      makeOptions({
        setAudio,
        ackFrames,
        latestAudioRef,
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
    expect(latestAudioRef.current).toBe(latest);
  });

  it("reduces active frames while snapshot publication is paused and keeps ingesting and acking", () => {
    const setAudio = vi.fn();
    const ackFrames = vi.fn();
    const pushFrame = vi.fn();
    const latestAudioRef = {
      current: makeOptions().latestAudioRef.current,
    };
    const { applyFrame } = buildTauriFrameApply(
      makeOptions({
        setAudio,
        ackFrames,
        latestAudioRef,
        intake: { pushFrame, pushVisualHistRow() {} },
        shouldPublishDisplay: () => false,
      })
    );

    for (let i = 1; i <= 6; i++) {
      applyFrame({
        seq: i,
        peakDb: [-20 + i],
        peakHoldDb: [-15],
        sampleLDb: i === 2 ? -8 : i === 5 ? -3 : undefined,
        sampleRDb: i === 3 ? -7 : i === 6 ? -2 : undefined,
      });
    }

    expect(setAudio).not.toHaveBeenCalled();
    expect(pushFrame).toHaveBeenCalledTimes(6);
    expect(ackFrames).toHaveBeenCalledWith(6);
    expect(latestAudioRef.current).toMatchObject({
      peakDb: [-14],
      samplePeakMaxL: -3,
      samplePeakMaxR: -2,
    });
  });

  it("publishes the reduced latest frame normally in live mode", () => {
    const setAudio = vi.fn();
    const latestAudioRef = { current: makeOptions().latestAudioRef.current };
    const { applyFrame } = buildTauriFrameApply(makeOptions({ setAudio, latestAudioRef }));

    applyFrame({ peakDb: [-9], peakHoldDb: [], lufsMomentary: -12 });

    expect(latestAudioRef.current).toMatchObject({ peakDb: [-9], momentary: -12 });
    expect(setAudio).toHaveBeenCalledOnce();
    expect(setAudio).toHaveBeenCalledWith(latestAudioRef.current);
  });

  it("reads updated history capacities from refs without rebuilding the frame handler", () => {
    const pushFrame = vi.fn();
    const histMaxSamples = { current: 10 };
    const visualMaxSamples = { current: 20 };
    const { applyFrame } = buildTauriFrameApply(
      makeOptions({
        histMaxSamples,
        visualMaxSamples,
        intake: { pushFrame, pushVisualHistRow() {} },
      })
    );

    applyFrame({ peakDb: [], peakHoldDb: [] });
    histMaxSamples.current = 30;
    visualMaxSamples.current = 40;
    applyFrame({ peakDb: [], peakHoldDb: [] });

    expect(pushFrame.mock.calls[0][1]).toBe(10);
    expect(pushFrame.mock.calls[0][4]).toBe(20);
    expect(pushFrame.mock.calls[1][1]).toBe(30);
    expect(pushFrame.mock.calls[1][4]).toBe(40);
  });

  it("propagates per-key spectrum/vectorscope live results into audio state", () => {
    let audioState = { spectrumResultsByKey: {}, vectorscopeResultsByKey: {} };
    const latestAudioRef = { current: audioState };
    const setAudio = (next) => {
      audioState = next;
    };
    const { applyFrame } = buildTauriFrameApply(makeOptions({ setAudio, latestAudioRef }));
    const spectrumResultsByKey = { "spectrum:pair:0:1:combined": { path: "p" } };
    const vectorscopeResultsByKey = { "vectorscope:pair:0:1": { path: "v" } };
    applyFrame({ peakDb: [], peakHoldDb: [], spectrumResultsByKey, vectorscopeResultsByKey });
    expect(audioState.spectrumResultsByKey).toBe(spectrumResultsByKey);
    expect(audioState.vectorscopeResultsByKey).toBe(vectorscopeResultsByKey);
  });
});
