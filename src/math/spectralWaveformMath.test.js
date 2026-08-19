import { describe, expect, it } from "vitest";
import {
  centroidYFraction,
  sliceSpectralWaveformMetrics,
  waveformFrequencyRgb,
} from "./spectralWaveformMath.js";

const palette = {
  low: [240, 90, 36],
  mid: [217, 70, 239],
  high: [67, 56, 202],
  neutral: [139, 139, 130],
};
const splits = { lowMidSplitHz: 200, midHighSplitHz: 2000 };

describe("spectral Waveform math", () => {
  it("uses neutral for silence and approaches the frequency hue as tonality rises", () => {
    expect(waveformFrequencyRgb(0, 1, splits, palette)).toEqual(palette.neutral);
    expect(waveformFrequencyRgb(1000, 0, splits, palette)).toEqual(palette.neutral);
    expect(waveformFrequencyRgb(50, 1, splits, palette)).toEqual(palette.low);
    expect(waveformFrequencyRgb(10000, 1, splits, palette)).toEqual(palette.high);
  });

  it("perceptually lifts low concentration so real-world bands stay distinguishable", () => {
    const color = waveformFrequencyRgb(50, 0.1, splits, palette);

    expect(color[0]).toBeGreaterThan(180);
    expect(color[1]).toBeLessThan(120);
    expect(color[2]).toBeLessThan(90);
  });

  it("maps centroid logarithmically from high at the top to low at the bottom", () => {
    expect(centroidYFraction(20000)).toBeCloseTo(0);
    expect(centroidYFraction(20)).toBeCloseTo(1);
    expect(centroidYFraction(Math.sqrt(20 * 20000))).toBeCloseTo(0.5);
    expect(centroidYFraction(0)).toBeNull();
  });

  it("aligns retained spectral rows to waveform buckets by timestamp", () => {
    const rows = [
      { timestampMs: 1000, dominantFrequencyHz: [100], spectralCentroidHz: [200], tonality: [0.8] },
      {
        timestampMs: 1040,
        dominantFrequencyHz: [1000],
        spectralCentroidHz: [2000],
        tonality: [0.4],
      },
    ];
    const result = sliceSpectralWaveformMetrics(rows, 1000, 1040, 3, 1);
    expect(Array.from(result.dominantFrequencyHz[0])).toEqual([100, 100, 1000]);
    expect(Array.from(result.spectralCentroidHz[0])).toEqual([200, 200, 2000]);
  });

  it("does not stretch stale spectral values across history gaps", () => {
    const rows = [
      {
        timestampMs: 1000,
        dominantFrequencyHz: [100],
        spectralCentroidHz: [200],
        tonality: [0.8],
      },
    ];
    const result = sliceSpectralWaveformMetrics(rows, 1000, 1200, 3, 1);
    expect(Array.from(result.dominantFrequencyHz[0])).toEqual([100, 100, 0]);
  });

  it("right-aligns startup metrics to the absolute Waveform bucket grid", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      timestampMs: index * 100,
      dominantFrequencyHz: [100 + index],
      spectralCentroidHz: [200 + index],
      tonality: [0.8],
    }));
    const result = sliceSpectralWaveformMetrics(rows, 0, 900, 600, 1, {
      newestVisibleTimestampMs: 900,
      visibleSamples: 600,
      pixelWidth: 600,
      fracPhase: 0,
    });

    expect(result.dominantFrequencyHz[0][589]).toBe(0);
    expect(result.dominantFrequencyHz[0][590]).toBe(100);
  });

  it("moves retained metrics left by exactly one bucket per main-history tick", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      timestampMs: index * 100,
      dominantFrequencyHz: [100 + index],
      spectralCentroidHz: [200 + index],
      tonality: [0.8],
    }));
    const first = sliceSpectralWaveformMetrics(rows, 0, 900, 600, 1, {
      newestVisibleTimestampMs: 900,
      visibleSamples: 600,
      pixelWidth: 600,
      fracPhase: 0,
    });
    const next = sliceSpectralWaveformMetrics(rows, 0, 1000, 600, 1, {
      newestVisibleTimestampMs: 1000,
      visibleSamples: 600,
      pixelWidth: 600,
      fracPhase: 0,
    });

    expect(first.dominantFrequencyHz[0][590]).toBe(100);
    expect(next.dominantFrequencyHz[0][589]).toBe(100);
  });

  it("does not re-phase retained metrics when the newest main-history interval jitters", () => {
    const visualRows = Array.from({ length: 27 }, (_, index) => ({
      timestampMs: index * 40,
      dominantFrequencyHz: [index * 40 || 1],
      spectralCentroidHz: [200],
      tonality: [0.8],
    }));
    const firstWaveformRows = Array.from({ length: 10 }, (_, index) => ({
      timestampMs: index * 100,
    }));
    const nextWaveformRows = [...firstWaveformRows, { timestampMs: 1030 }];
    const first = sliceSpectralWaveformMetrics(visualRows, 0, 900, 600, 1, {
      newestVisibleTimestampMs: 900,
      visibleSamples: 600,
      pixelWidth: 600,
      fracPhase: 0,
      waveformRows: firstWaveformRows,
      effectiveOffsetSamples: 0,
    });
    const next = sliceSpectralWaveformMetrics(visualRows, 0, 1030, 600, 1, {
      newestVisibleTimestampMs: 1030,
      visibleSamples: 600,
      pixelWidth: 600,
      fracPhase: 0,
      waveformRows: nextWaveformRows,
      effectiveOffsetSamples: 0,
    });

    expect(first.dominantFrequencyHz[0][590]).toBe(40);
    expect(next.dominantFrequencyHz[0][589]).toBe(40);
  });
});
