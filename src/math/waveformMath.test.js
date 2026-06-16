import { describe, it, expect } from "vitest";
import { sliceWaveformSubHistory, WAVEFORM_DECIM_COLUMNS } from "./waveformMath.js";

// Build an entry whose sub-blocks ramp from -amp..+amp across `subCount` blocks,
// single channel.
function rampEntry(subCount, amp) {
  const pairs = new Float32Array(subCount * 2);
  for (let s = 0; s < subCount; s++) {
    const v = amp * ((s + 1) / subCount);
    pairs[s * 2] = -v;
    pairs[s * 2 + 1] = v;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: subCount,
    waveformMin: [-amp],
    waveformMax: [amp],
  };
}

describe("sliceWaveformSubHistory", () => {
  it("returns zero-filled column arrays of length WAVEFORM_DECIM_COLUMNS for empty input", () => {
    const r = sliceWaveformSubHistory([], 100, 0, 2);
    expect(r.columns).toBe(WAVEFORM_DECIM_COLUMNS);
    expect(r.mins).toHaveLength(2);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    expect(r.maxes[0].every((v) => v === 0)).toBe(true);
  });

  it("produces a smooth curve — far more distinct levels than the ~50 history ticks", () => {
    // 50 entries (5s @10Hz), each 19 sub-blocks ramping → ~950 distinct sub-pairs.
    const entries = Array.from({ length: 50 }, (_, i) => rampEntry(19, (0.8 * (i + 1)) / 50));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    // The old whole-tick path would yield <= 50 distinct values; sub-blocks must beat that.
    const distinct = new Set(r.maxes[0]).size;
    expect(distinct).toBeGreaterThan(100);
  });

  it("has no empty interior gaps — every interior column carries data", () => {
    const entries = Array.from({ length: 50 }, () => rampEntry(19, 0.8));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1);
    // With a full window, the last column must be data, not the initial 0 fill.
    expect(r.maxes[0][WAVEFORM_DECIM_COLUMNS - 1]).toBeGreaterThan(0);
  });

  it("falls back to whole-tick min/max for entries lacking sub-pairs", () => {
    const entries = [
      { waveformMin: [-0.4], waveformMax: [0.4] }, // no sub-pairs
      { waveformMin: [-0.9], waveformMax: [0.9] },
    ];
    const r = sliceWaveformSubHistory(entries, 2, 0, 1);
    expect(r.maxes[0]).toHaveLength(WAVEFORM_DECIM_COLUMNS);
    const peak = Math.max(...r.maxes[0]);
    expect(peak).toBeCloseTo(0.9, 5);
  });

  it("respects effectiveOffsetSamples — skips the most-recent entries", () => {
    const entries = [rampEntry(19, 0.2), rampEntry(19, 0.5), rampEntry(19, 0.9)];
    const skipNewest = sliceWaveformSubHistory(entries, 10, 1, 1); // exclude last (0.9)
    expect(Math.max(...skipNewest.maxes[0])).toBeCloseTo(0.5, 5);
  });
});
