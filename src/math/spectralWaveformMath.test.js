import { describe, expect, it } from "vitest";
import { WaveformVisualHistorySlab } from "../lib/WaveformVisualHistorySlab.js";
import {
  centroidYFraction,
  sliceSpectralWaveformMetrics,
  waveformFrequencyRgb,
  waveformFrequencyRgbInto,
  waveformFrequencyScale,
} from "./spectralWaveformMath.js";

/**
 * The colour map as it stood before the per-bucket form existed, transcribed here on purpose.
 *
 * A Frequency Color draw calls this once per pixel column, so the shipped version hoists the
 * anchors out and writes into a reused array instead of allocating. That is a speed change only:
 * this reference is what pins it to the same bytes, and it has to stay an independent copy --
 * sharing an implementation with the code under test would make the comparison vacuous.
 */
function referenceFrequencyRgb(frequencyHz, tonality, { lowMidSplitHz, midHighSplitHz }, palette) {
  const { low, mid, high, neutral } = palette;
  const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const mix = (first, second, amount) => {
    const t = clamp01(amount);
    return first.map((value, index) => Math.round(value + (second[index] - value) * t));
  };
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return [...neutral];
  const lowAnchor = Math.sqrt(20 * lowMidSplitHz);
  const midAnchor = Math.sqrt(lowMidSplitHz * midHighSplitHz);
  const highAnchor = Math.sqrt(midHighSplitHz * 20000);
  const logFrequency = Math.log(Math.max(20, frequencyHz));
  let hue;
  if (frequencyHz <= lowAnchor) hue = low;
  else if (frequencyHz < midAnchor) {
    hue = mix(
      low,
      mid,
      (logFrequency - Math.log(lowAnchor)) / (Math.log(midAnchor) - Math.log(lowAnchor))
    );
  } else if (frequencyHz < highAnchor) {
    hue = mix(
      mid,
      high,
      (logFrequency - Math.log(midAnchor)) / (Math.log(highAnchor) - Math.log(midAnchor))
    );
  } else hue = high;
  return mix(neutral, hue, Math.pow(clamp01(tonality), 0.35));
}

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

  it("BYTE EQUIVALENCE: the per-bucket form matches the reference across the input space", () => {
    // Anchor boundaries are where an interpolation branch can be picked differently, and the
    // branch decision uses the raw frequency while the interpolation uses its logarithm -- so the
    // sweep has to land exactly on the anchors, not merely near them.
    for (const splitPair of [
      { lowMidSplitHz: 200, midHighSplitHz: 2000 },
      { lowMidSplitHz: 120, midHighSplitHz: 6000 },
    ]) {
      const scale = waveformFrequencyScale(splitPair, palette);
      const anchors = [
        Math.sqrt(20 * splitPair.lowMidSplitHz),
        Math.sqrt(splitPair.lowMidSplitHz * splitPair.midHighSplitHz),
        Math.sqrt(splitPair.midHighSplitHz * 20000),
      ];
      const frequencies = [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        1e-9,
        5,
        19.999,
        20,
        21,
        19999,
        20000,
        48000,
        ...anchors.flatMap((a) => [a - 1e-9, a, a + 1e-9, a * 0.5, a * 1.5]),
        ...Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199)),
      ];
      const tonalities = [
        0,
        -0.5,
        Number.NaN,
        1,
        1.5,
        1e-6,
        0.25,
        0.5,
        0.75,
        ...Array.from({ length: 40 }, (_, i) => i / 39),
      ];
      const out = [0, 0, 0];
      for (const frequencyHz of frequencies) {
        for (const tonality of tonalities) {
          const expected = referenceFrequencyRgb(frequencyHz, tonality, splitPair, palette);
          expect(waveformFrequencyRgbInto(scale, frequencyHz, tonality, out)).toEqual(expected);
          expect(waveformFrequencyRgb(frequencyHz, tonality, splitPair, palette)).toEqual(expected);
        }
      }
    }
  });

  it("never hands back the palette array itself, so a caller cannot corrupt the theme", () => {
    const scale = waveformFrequencyScale(splits, palette);
    const silent = waveformFrequencyRgbInto(scale, 0, 1, [0, 0, 0]);
    silent[0] = 999;
    expect(palette.neutral[0]).not.toBe(999);
    expect(waveformFrequencyRgb(50, 1, splits, palette)).not.toBe(palette.low);
  });

  describe("finding the window in a long ring", () => {
    const ROW_MS = 40;
    const CHANNELS = 2;
    const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

    function ring(rowCount, firstTimestampMs = 0) {
      const slab = new WaveformVisualHistorySlab(rowCount, CHANNELS);
      for (let i = 0; i < rowCount; i += 1) {
        // Values are a function of the timestamp, not of the row index: the whole point of the
        // comparison is that the same moment carries the same numbers in both rings.
        const timestampMs = firstTimestampMs + i * ROW_MS;
        const tick = Math.round(timestampMs / ROW_MS);
        slab.push({
          timestampMs,
          dominantFrequencyHz: [200 + mod(tick, 97) * 13, 300 + mod(tick, 61) * 7],
          spectralCentroidHz: [800 + mod(tick, 53) * 11, 900 + mod(tick, 47) * 9],
          tonality: [mod(tick, 32) / 32, mod(tick, 16) / 16],
        });
      }
      return slab;
    }

    function counting(slab) {
      const reads = { rowAt: 0, timestampAt: 0 };
      return {
        reads,
        rows: {
          get length() {
            return slab.length;
          },
          rowAt(index) {
            reads.rowAt += 1;
            return slab.rowAt(index);
          },
          timestampAt(index) {
            reads.timestampAt += 1;
            return slab.timestampAt(index);
          },
        },
      };
    }

    function slice(rows, newestMs, windowMs, pixelWidth) {
      return sliceSpectralWaveformMetrics(
        rows,
        newestMs - windowMs,
        newestMs,
        pixelWidth,
        CHANNELS,
        {
          newestVisibleTimestampMs: newestMs,
          visibleSamples: Math.round(windowMs / 95),
          pixelWidth,
          fracPhase: 0,
          waveformRows: null,
          effectiveOffsetSamples: 0,
          nominalIntervalMs: 95,
        }
      );
    }

    it("gives the same answer no matter how much older history sits in front of it", () => {
      // The visible window is the last 60 s either way; only the amount of history before it
      // differs. Any dependence on that would be the seek landing somewhere it should not.
      const windowMs = 60_000;
      const visibleRows = windowMs / ROW_MS;
      for (const pixelWidth of [340, 1200]) {
        const short = ring(visibleRows + 1);
        const shortNewest = short.timestampAt(short.length - 1);
        const expected = slice(short, shortNewest, windowMs, pixelWidth);

        for (const olderRows of [1, 500, 20_000]) {
          const long = ring(visibleRows + 1 + olderRows, -olderRows * ROW_MS);
          const longNewest = long.timestampAt(long.length - 1);
          expect(longNewest).toBe(shortNewest);
          const actual = slice(long, longNewest, windowMs, pixelWidth);
          for (const field of ["dominantFrequencyHz", "spectralCentroidHz", "tonality"]) {
            for (let channel = 0; channel < CHANNELS; channel += 1) {
              expect(Array.from(actual[field][channel])).toEqual(
                Array.from(expected[field][channel])
              );
            }
          }
        }
      }
    });

    it("READ BOUND: reaching the window costs a search, not a walk over the whole ring", () => {
      // One hour of retention is 90000 rows at 25 Hz, and the panel re-runs this on every visual
      // tick. A per-row walk to reach the newest 60 s is what made that a per-frame cost that grew
      // with session length; the bound below is what stops it coming back.
      const windowMs = 60_000;
      const pixelWidth = 1200;
      const visibleRows = windowMs / ROW_MS;
      const totalRows = 90_000;
      const slab = ring(totalRows);
      const probe = counting(slab);
      const newestMs = slab.timestampAt(totalRows - 1);

      slice(probe.rows, newestMs, windowMs, pixelWidth);

      const reads = probe.reads.rowAt + probe.reads.timestampAt;
      const bound = 2 * Math.ceil(Math.log2(totalRows)) + 4 * (visibleRows + pixelWidth) + 16;
      expect(reads).toBeLessThanOrEqual(bound);
      // And nothing that scales with the rows sitting in front of the window.
      expect(reads).toBeLessThan(totalRows / 4);
    });

    it("lands on the newest row at or before the window, duplicates and gaps included", () => {
      const slab = new WaveformVisualHistorySlab(8, 1);
      // Two rows share a timestamp, and there is a gap after them.
      for (const [timestampMs, frequency] of [
        [0, 100],
        [40, 200],
        [40, 300],
        [400, 400],
        [440, 500],
      ]) {
        slab.push({
          timestampMs,
          dominantFrequencyHz: [frequency],
          spectralCentroidHz: [frequency],
          tonality: [1],
        });
      }
      // One bucket, asking for the moment of the duplicated timestamp: the newer of the pair wins,
      // which is what a walk forward through equal timestamps also lands on.
      const result = sliceSpectralWaveformMetrics(slab, 40, 40, 1, 1, {
        newestVisibleTimestampMs: 40,
        visibleSamples: 1,
        pixelWidth: 1,
        fracPhase: 0,
        waveformRows: null,
        effectiveOffsetSamples: 0,
        nominalIntervalMs: 40,
      });
      expect(result.dominantFrequencyHz[0][0]).toBe(300);
    });
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
