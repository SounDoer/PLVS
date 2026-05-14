import { describe, expect, it, vi } from "vitest";
import { FrameIntake } from "./FrameIntake.js";
import { resetFloatMeteringState } from "./resetFloatMeteringState.js";

describe("resetFloatMeteringState", () => {
  it("clears refs, intake, paths, and selection to match a native Clear", () => {
    const frameRef = { current: 99 };
    const selectedOffsetRef = { current: 5 };
    const intake = new FrameIntake();
    // Pre-populate intake with some data
    intake.pushHistRow(
      {
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
        spectrumBandCentersHz: [],
        spectrumSmoothDb: [],
      },
      1000,
      48000
    );
    const setSpectrumPath = vi.fn();
    const setSpectrumPeakPath = vi.fn();
    const setVectorPath = vi.fn();
    const setAudio = vi.fn();
    const setSelectedOffset = vi.fn();

    resetFloatMeteringState({
      frameRef,
      selectedOffsetRef,
      intake,
      setAudio,
      setSpectrumPath,
      setSpectrumPeakPath,
      setVectorPath,
      setSelectedOffset,
    });

    expect(frameRef.current).toBe(0);
    expect(selectedOffsetRef.current).toBe(-1);
    expect(intake.getLoudnessHistory()).toHaveLength(0);
    expect(intake.getAudioSnap()).toHaveLength(0);
    expect(intake.getCorrSnap()).toHaveLength(0);
    expect(intake.getVectorSnap()).toHaveLength(0);
    expect(intake.getSpectrumSnap()).toHaveLength(0);
    expect(intake.getSpectrumDataSnap()).toHaveLength(0);
    expect(intake.getSpectrumData()).toBeNull();
    expect(setSpectrumPath).toHaveBeenCalledWith("");
    expect(setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(setAudio).toHaveBeenCalled();
  });
});
