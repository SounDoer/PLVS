import { describe, expect, it, vi } from "vitest";
import { resetFloatMeteringState } from "./resetFloatMeteringState.js";

describe("resetFloatMeteringState", () => {
  it("clears refs, paths, and selection to match a native Clear", () => {
    const frameRef = { current: 99 };
    const selectedOffsetRef = { current: 5 };
    const histRef = { current: [1, 2] };
    const loudnessHistRef = { current: [{ m: 1, st: 2 }] };
    const spectrumDataRef = { current: { x: 1 } };
    const spectrumDataSnapRef = { current: [1] };
    const spectrumSnapRef = { current: [2] };
    const vectorSnapRef = { current: [3] };
    const corrSnapRef = { current: [0.1] };
    const audioSnapRef = { current: [4] };
    const setSpectrumPath = vi.fn();
    const setSpectrumPeakPath = vi.fn();
    const setVectorPath = vi.fn();
    const setAudio = vi.fn();
    const setSelectedOffset = vi.fn();
    resetFloatMeteringState({
      frameRef,
      selectedOffsetRef,
      histRef,
      loudnessHistRef,
      spectrumDataRef,
      spectrumDataSnapRef,
      spectrumSnapRef,
      vectorSnapRef,
      corrSnapRef,
      audioSnapRef,
      setAudio,
      setSpectrumPath,
      setSpectrumPeakPath,
      setVectorPath,
      setSelectedOffset,
    });
    expect(frameRef.current).toBe(0);
    expect(selectedOffsetRef.current).toBe(-1);
    expect(histRef.current).toEqual([]);
    expect(loudnessHistRef.current).toEqual([]);
    expect(spectrumDataRef.current).toBeNull();
    expect(spectrumDataSnapRef.current).toEqual([]);
    expect(spectrumSnapRef.current).toEqual([]);
    expect(vectorSnapRef.current).toEqual([]);
    expect(corrSnapRef.current).toEqual([]);
    expect(audioSnapRef.current).toEqual([]);
    expect(setSpectrumPath).toHaveBeenCalledWith("");
    expect(setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(setAudio).toHaveBeenCalled();
  });
});
