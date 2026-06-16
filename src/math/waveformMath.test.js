import { describe, it, expect } from "vitest";
import { sliceWaveformSubHistory } from "./waveformMath.js";

const SUBS = 19;
function flatEntry(amp) {
  const pairs = new Float32Array(SUBS * 2); // 1 channel, stride 2
  for (let s = 0; s < SUBS; s++) {
    pairs[s * 2] = -amp;
    pairs[s * 2 + 1] = amp;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: SUBS,
    waveformMin: [-amp],
    waveformMax: [amp],
  };
}
function spikeEntry(baseAmp, spikeAmp, spikeSub) {
  const pairs = new Float32Array(SUBS * 2);
  for (let s = 0; s < SUBS; s++) {
    const a = s === spikeSub ? spikeAmp : baseAmp;
    pairs[s * 2] = -a;
    pairs[s * 2 + 1] = a;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: SUBS,
    waveformMin: [-spikeAmp],
    waveformMax: [spikeAmp],
  };
}
// 50 flat entries with one sharp spike at entry 25.
function spikeTrack() {
  return Array.from({ length: 50 }, (_, i) =>
    i === 25 ? spikeEntry(0.2, 0.95, 9) : flatEntry(0.2)
  );
}

describe("sliceWaveformSubHistory", () => {
  it("returns zero arrays without throwing for empty input", () => {
    const r = sliceWaveformSubHistory([], 100, 0, 2, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(1);
    expect(r.mins).toHaveLength(2);
    expect(r.maxes[0]).toHaveLength(r.bucketCount);
    expect(r.maxes[0].every((v) => v === 0)).toBe(true);
    expect(Number.isFinite(r.fracPhase)).toBe(true);
    expect(r.firstBucket).toBe(-1);
    expect(r.lastBucket).toBe(-1);
  });

  it("reports the data-bucket range so the envelope can grow from the right", () => {
    // Few entries in a wide window: data occupies only the rightmost buckets.
    const entries = Array.from({ length: 5 }, () => flatEntry(0.5));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1, 300);
    expect(r.firstBucket).toBeGreaterThan(r.bucketCount / 2); // leading half stays empty
    expect(r.lastBucket).toBeGreaterThanOrEqual(r.bucketCount - 2); // data hugs the right edge
  });

  it("emits roughly one bucket per device pixel", () => {
    const r = sliceWaveformSubHistory(spikeTrack(), 50, 0, 1, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(300);
    expect(r.bucketCount).toBeLessThanOrEqual(302);
  });

  it("produces a smooth curve — far more distinct levels than the ~50 ticks", () => {
    const entries = Array.from({ length: 50 }, (_, i) => flatEntry((0.8 * (i + 1)) / 50));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1, 300);
    expect(new Set(r.maxes[0]).size).toBeGreaterThan(40);
  });

  it("SCROLL STABILITY: scrolling exactly one bucket translates by one column, peak unchanged", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const a = sliceWaveformSubHistory(entries, 50, 0, 1, W);
    const b = sliceWaveformSubHistory(entries, 50, coordsPerBucket, 1, W);

    expect(Math.max(...a.maxes[0])).toBeCloseTo(0.95, 5);
    expect(Math.max(...b.maxes[0])).toBeCloseTo(0.95, 5); // peak preserved, not dropped
    expect(b.fracPhase).toBeCloseTo(a.fracPhase, 6); // whole-bucket scroll keeps phase

    const peakA = a.maxes[0].indexOf(Math.max(...a.maxes[0]));
    const peakB = b.maxes[0].indexOf(Math.max(...b.maxes[0]));
    expect(peakB).toBe(peakA + 1); // pure 1-column translation
  });

  it("SUB-BUCKET scroll preserves the peak value and yields fracPhase in [0,1)", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const c = sliceWaveformSubHistory(entries, 50, coordsPerBucket * 0.4, 1, W);
    expect(Math.max(...c.maxes[0])).toBeCloseTo(0.95, 5);
    expect(c.fracPhase).toBeGreaterThanOrEqual(0);
    expect(c.fracPhase).toBeLessThan(1);
  });

  it("falls back to whole-tick bounds for entries lacking sub-pairs", () => {
    const entries = [
      { waveformMin: [-0.4], waveformMax: [0.4] },
      { waveformMin: [-0.9], waveformMax: [0.9] },
    ];
    const r = sliceWaveformSubHistory(entries, 2, 0, 1, 200);
    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.9, 5);
  });
});
