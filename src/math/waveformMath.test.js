import { describe, it, expect } from "vitest";
import { sliceWaveformHistory } from "./waveformMath.js";

describe("sliceWaveformHistory", () => {
  it("returns empty per-channel arrays when histSourceList is empty", () => {
    const result = sliceWaveformHistory([], 100, 0, 2);
    expect(result.entryCount).toBe(0);
    expect(result.mins).toHaveLength(2);
    expect(result.maxes).toHaveLength(2);
    expect(result.mins[0]).toHaveLength(0);
    expect(result.maxes[0]).toHaveLength(0);
  });

  it("extracts per-channel min/max for the visible window", () => {
    const entries = [
      { waveformMin: [-0.5, -0.3], waveformMax: [0.5, 0.3] },
      { waveformMin: [-0.8, -0.2], waveformMax: [0.8, 0.2] },
    ];
    const result = sliceWaveformHistory(entries, 10, 0, 2);
    expect(result.entryCount).toBe(2);
    expect(result.mins[0]).toEqual([-0.5, -0.8]);
    expect(result.maxes[0]).toEqual([0.5, 0.8]);
    expect(result.mins[1]).toEqual([-0.3, -0.2]);
    expect(result.maxes[1]).toEqual([0.3, 0.2]);
  });

  it("reports the leading empty samples for right-aligned partial live data", () => {
    const entries = [
      { waveformMin: [-0.5], waveformMax: [0.5] },
      { waveformMin: [-0.8], waveformMax: [0.8] },
    ];
    const result = sliceWaveformHistory(entries, 5, 0, 1);
    expect(result.entryCount).toBe(2);
    expect(result.leadingEmptySamples).toBe(3);
    expect(result.windowSamples).toBe(5);
  });

  it("respects effectiveOffsetSamples — skips the most-recent N entries", () => {
    const entries = [
      { waveformMin: [-0.1, 0], waveformMax: [0.1, 0] }, // oldest
      { waveformMin: [-0.5, 0], waveformMax: [0.5, 0] },
      { waveformMin: [-0.9, 0], waveformMax: [0.9, 0] }, // newest — skipped
    ];
    // effectiveOffsetSamples=1 → exclude last 1 entry; show indices 0 and 1
    const result = sliceWaveformHistory(entries, 10, 1, 1);
    expect(result.entryCount).toBe(2);
    expect(result.maxes[0]).toEqual([0.1, 0.5]);
  });

  it("limits to visibleSamples entries", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      waveformMin: [-i * 0.01],
      waveformMax: [i * 0.01],
    }));
    const result = sliceWaveformHistory(entries, 5, 0, 1);
    expect(result.entryCount).toBe(5);
  });

  it("falls back to 0 for missing channel data", () => {
    const entries = [{ waveformMin: [-0.5], waveformMax: [0.5] }]; // only 1 channel
    const result = sliceWaveformHistory(entries, 10, 0, 2); // requesting 2
    expect(result.mins[1][0]).toBe(0);
    expect(result.maxes[1][0]).toBe(0);
  });
});
