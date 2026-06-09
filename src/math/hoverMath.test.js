import { describe, expect, it } from "vitest";
import {
  formatHoverOffset,
  formatSpectrumFreq,
  computeHistoryHoverPoint,
  computeSpectrumHoverIndex,
  computeWaveformHoverPoint,
  computeSpectrogramHoverPoint,
} from "./hoverMath";

describe("formatHoverOffset", () => {
  it("formats sub-10s with one decimal", () => {
    expect(formatHoverOffset(3.4)).toBe("3.4s ago");
  });

  it("formats >= 10s with no decimal", () => {
    expect(formatHoverOffset(15.7)).toBe("16s ago");
  });

  it("formats >= 60s as m+s, remainder >= 10s has no decimal", () => {
    expect(formatHoverOffset(90)).toBe("1m 30s ago");
  });

  it("formats >= 60s, remainder < 10s keeps one decimal", () => {
    expect(formatHoverOffset(63)).toBe("1m 3.0s ago");
  });

  it("clamps negative input to 0", () => {
    expect(formatHoverOffset(-5)).toBe("0.0s ago");
  });
});

describe("formatSpectrumFreq", () => {
  it("formats Hz below 1kHz as integer Hz", () => {
    expect(formatSpectrumFreq(440)).toBe("440 Hz");
  });

  it("formats >= 1kHz as kHz with two decimals when < 10kHz", () => {
    expect(formatSpectrumFreq(2500)).toBe("2.50 kHz");
  });

  it("formats >= 10kHz with one decimal", () => {
    expect(formatSpectrumFreq(12000)).toBe("12.0 kHz");
  });

  it("returns '-' for non-finite input", () => {
    expect(formatSpectrumFreq(NaN)).toBe("-");
    expect(formatSpectrumFreq(Infinity)).toBe("-");
  });
});

describe("computeHistoryHoverPoint", () => {
  const samples = [
    { m: -23, st: -24 },
    { m: -22, st: -23 },
    { m: -21, st: -22 },
  ];

  it("returns null for empty list", () => {
    expect(computeHistoryHoverPoint(0, [], 0, 10, 0.1)).toBeNull();
  });

  it("returns a hover object at a valid position", () => {
    const result = computeHistoryHoverPoint(0.5, samples, 0, 3, 0.1);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("leftPct");
    expect(result).toHaveProperty("offsetLabel");
  });

  it("leftPct is between 0 and 100", () => {
    const r = computeHistoryHoverPoint(0.5, samples, 0, 3, 0.1);
    expect(r.leftPct).toBeGreaterThanOrEqual(0);
    expect(r.leftPct).toBeLessThanOrEqual(100);
  });

  it("exposes momentary and shortTerm values", () => {
    const r = computeHistoryHoverPoint(0, samples, 0, 3, 0.1);
    expect(typeof r.momentary).toBe("number");
    expect(typeof r.shortTerm).toBe("number");
  });
});

describe("computeSpectrumHoverIndex", () => {
  const bands = [{ fCenter: 100 }, { fCenter: 1000 }, { fCenter: 10000 }];

  it("returns the nearest band index for a pointer near the left", () => {
    const idx = computeSpectrumHoverIndex(0, bands);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(bands.length);
  });

  it("returns an index within bounds for any xFrac", () => {
    for (const xFrac of [0, 0.5, 1]) {
      const idx = computeSpectrumHoverIndex(xFrac, bands);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(bands.length);
    }
  });
});

describe("computeWaveformHoverPoint", () => {
  const mins = [
    [-0.5, -0.3, -0.1],
    [-0.4, -0.2, -0.05],
  ];
  const maxes = [
    [0.5, 0.3, 0.1],
    [0.4, 0.2, 0.05],
  ];
  const labels = ["L", "R"];
  const entryCount = 3;
  const effectiveOffsetSamples = 2;
  const visibleSamples = 3;
  const sampleSec = 0.1;

  it("returns null when entryCount is 0", () => {
    expect(computeWaveformHoverPoint(0.5, [], [], 0, 0, 0, 0.1, ["L"])).toBeNull();
  });

  it("leftPct equals xFrac * 100", () => {
    const r = computeWaveformHoverPoint(
      0.6,
      mins,
      maxes,
      entryCount,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec,
      labels
    );
    expect(r.leftPct).toBeCloseTo(60);
  });

  it("at xFrac=1 (rightmost), offsetSec = effectiveOffsetSamples * sampleSec", () => {
    const r = computeWaveformHoverPoint(
      1,
      mins,
      maxes,
      entryCount,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec,
      labels
    );
    // sliceIndex = round(1 * (3-1)) = 2 (newest)
    // offsetFromEnd = effectiveOffsetSamples + (entryCount - 1 - 2) = 2 + 0 = 2
    // offsetSec = 2 * 0.1 = 0.2s
    expect(r.timeLabel).toBe("0.2s ago");
  });

  it("at xFrac=0 (leftmost), offsetSec = (effectiveOffsetSamples + entryCount - 1) * sampleSec", () => {
    const r = computeWaveformHoverPoint(
      0,
      mins,
      maxes,
      entryCount,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec,
      labels
    );
    // sliceIndex = round(0 * 2) = 0 (oldest)
    // offsetFromEnd = effectiveOffsetSamples + (entryCount - 1 - 0) = 2 + 2 = 4
    // offsetSec = 4 * 0.1 = 0.4s
    expect(r.timeLabel).toBe("0.4s ago");
  });

  it("dbFs is 0 for maxAmp=1.0", () => {
    const r = computeWaveformHoverPoint(1, [[1.0]], [[1.0]], 1, 0, 1, 0.1, ["L"]);
    expect(r.channels[0].dbFs).toBeCloseTo(0);
  });

  it("dbFs is approximately -6.02 for maxAmp=0.5", () => {
    const r = computeWaveformHoverPoint(1, [[0.5]], [[0.5]], 1, 0, 1, 0.1, ["L"]);
    expect(r.channels[0].dbFs).toBeCloseTo(-6.02, 1);
  });

  it("channels array has correct labels", () => {
    const r = computeWaveformHoverPoint(
      0.5,
      mins,
      maxes,
      entryCount,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec,
      labels
    );
    expect(r.channels.map((c) => c.label)).toEqual(["L", "R"]);
  });
});

describe("computeSpectrogramHoverPoint", () => {
  const makeSnap = (bands, dbList) => ({ bands, dbList });
  const testBands = [{ fCenter: 100 }, { fCenter: 1000 }, { fCenter: 10000 }];
  const testDbList = [-50, -30, -20];
  const snaps = [makeSnap(testBands, testDbList)];

  it("returns null for empty snaps array", () => {
    expect(computeSpectrogramHoverPoint(0.5, 0.5, [], 0, 1, 0.04)).toBeNull();
  });

  it("leftPct equals xFrac * 100", () => {
    const r = computeSpectrogramHoverPoint(0.4, 0.5, snaps, 0, 1, 0.04);
    expect(r).not.toBeNull();
    expect(r.leftPct).toBeCloseTo(40);
  });

  it("topPct equals yFrac * 100", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.3, snaps, 0, 1, 0.04);
    expect(r).not.toBeNull();
    expect(r.topPct).toBeCloseTo(30);
  });

  it("timeLabel is a string", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, 0, 1, 0.04);
    expect(r).not.toBeNull();
    expect(typeof r.timeLabel).toBe("string");
    expect(r.timeLabel).toMatch(/ago/);
  });

  it("freqLabel is a string containing Hz or kHz", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, 0, 1, 0.04);
    expect(r).not.toBeNull();
    expect(typeof r.freqLabel).toBe("string");
    expect(r.freqLabel).toMatch(/Hz/);
  });

  it("dbLabel is in -XX.X dB format", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, 0, 1, 0.04);
    expect(r).not.toBeNull();
    expect(r.dbLabel).toMatch(/^-?\d+\.\d dB$/);
  });

  it("returns null when snap has no bands", () => {
    const emptyBandsSnap = [makeSnap([], testDbList)];
    expect(computeSpectrogramHoverPoint(0.5, 0.5, emptyBandsSnap, 0, 1, 0.04)).toBeNull();
  });

  it("returns null when snap has no dbList", () => {
    const emptyDbSnap = [makeSnap(testBands, [])];
    expect(computeSpectrogramHoverPoint(0.5, 0.5, emptyDbSnap, 0, 1, 0.04)).toBeNull();
  });
});
