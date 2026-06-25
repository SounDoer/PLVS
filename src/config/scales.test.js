import { describe, it, expect } from "vitest";
import {
  peakFrac,
  peakFromTopFrac,
  PEAK_DB_MIN,
  PEAK_DB_MAX,
  loudnessFromTopFrac,
  LOUDNESS_DB_MIN,
  LOUDNESS_DB_MAX,
  spectrumDbToYViewBox,
  spectrumDbToTopFrac,
  buildSpectrumYTicks,
  SPEC_VIEW_H,
  SPEC_VIEW_TOP_PAD,
  SPEC_VIEW_BOTTOM_PAD,
  freqToXFrac,
  buildRtaBands,
  getWeightingDb,
} from "./scales";

describe("peakFrac", () => {
  it("maps max dB to 1", () => expect(peakFrac(PEAK_DB_MAX)).toBe(1));
  it("maps min dB to 0", () => expect(peakFrac(PEAK_DB_MIN)).toBe(0));
  it("clamps values above max", () => expect(peakFrac(100)).toBe(1));
  it("clamps values below min", () => expect(peakFrac(-200)).toBe(0));
  it("maps midpoint to 0.5", () => {
    const mid = (PEAK_DB_MAX + PEAK_DB_MIN) / 2;
    expect(peakFrac(mid)).toBeCloseTo(0.5);
  });
});

describe("peakFromTopFrac", () => {
  it("max dB maps to 0 (top of meter)", () => expect(peakFromTopFrac(PEAK_DB_MAX)).toBe(0));
  it("min dB maps to 1 (bottom of meter)", () => expect(peakFromTopFrac(PEAK_DB_MIN)).toBe(1));
  it("is the inverse of peakFrac", () => {
    expect(peakFromTopFrac(-12)).toBeCloseTo(1 - peakFrac(-12));
  });
});

describe("loudnessFromTopFrac", () => {
  it("max (0 dB) maps to 0 (top)", () => expect(loudnessFromTopFrac(LOUDNESS_DB_MAX)).toBe(0));
  it("min (-64 dB) maps to 1 (bottom)", () => expect(loudnessFromTopFrac(LOUDNESS_DB_MIN)).toBe(1));
  it("clamps values above max", () => expect(loudnessFromTopFrac(10)).toBe(0));
  it("clamps values below min", () => expect(loudnessFromTopFrac(-100)).toBe(1));
  it("maps midpoint to 0.5", () => {
    const mid = (LOUDNESS_DB_MAX + LOUDNESS_DB_MIN) / 2;
    expect(loudnessFromTopFrac(mid)).toBeCloseTo(0.5);
  });
});

describe("spectrumDbToYViewBox", () => {
  it("-12 dB maps below viewBox top by SPEC_VIEW_TOP_PAD", () =>
    expect(spectrumDbToYViewBox(-12)).toBe(SPEC_VIEW_TOP_PAD));
  it("-96 dB maps above viewBox bottom by SPEC_VIEW_BOTTOM_PAD", () => {
    expect(spectrumDbToYViewBox(-96)).toBe(SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD);
  });
  it("clamps values above -12 dB", () => expect(spectrumDbToYViewBox(10)).toBe(SPEC_VIEW_TOP_PAD));
  it("clamps values below -96 dB", () => {
    expect(spectrumDbToYViewBox(-200)).toBe(SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD);
  });
  it("-54 dB maps to vertical midpoint of plot band", () => {
    const midY = SPEC_VIEW_TOP_PAD + (SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD) / 2;
    expect(spectrumDbToYViewBox(-54)).toBeCloseTo(midY);
  });
  it("supports a custom display range", () => {
    expect(spectrumDbToYViewBox(-24, { yMaxDb: -24, yRangeDb: 60 })).toBe(SPEC_VIEW_TOP_PAD);
    expect(spectrumDbToYViewBox(-84, { yMaxDb: -24, yRangeDb: 60 })).toBe(
      SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD
    );
  });
});

describe("spectrumDbToTopFrac", () => {
  it("-12 dB maps to fraction of viewBox height at top pad", () => {
    expect(spectrumDbToTopFrac(-12)).toBeCloseTo(SPEC_VIEW_TOP_PAD / SPEC_VIEW_H);
  });
  it("-96 dB maps to fraction just below full height", () => {
    expect(spectrumDbToTopFrac(-96)).toBeCloseTo(
      (SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD) / SPEC_VIEW_H
    );
  });
  it("consistent with spectrumDbToYViewBox", () => {
    expect(spectrumDbToTopFrac(-40)).toBeCloseTo(spectrumDbToYViewBox(-40) / SPEC_VIEW_H);
  });
});

describe("buildSpectrumYTicks", () => {
  it("generates default -12..-96 dB ticks", () => {
    expect(buildSpectrumYTicks({ yMaxDb: -12, yRangeDb: 84 }).map((tick) => tick.v)).toEqual([
      -12, -24, -36, -48, -60, -72, -84, -96,
    ]);
  });

  it("always includes top and bottom for custom ranges", () => {
    expect(buildSpectrumYTicks({ yMaxDb: -18, yRangeDb: 48 }).map((tick) => tick.v)).toEqual([
      -18, -30, -42, -54, -66,
    ]);
  });
});

describe("freqToXFrac", () => {
  it("20 Hz maps to 0 (left edge)", () => expect(freqToXFrac(20)).toBe(0));
  it("20000 Hz maps to 1 (right edge)", () => expect(freqToXFrac(20000)).toBe(1));
  it("clamps below 20 Hz", () => expect(freqToXFrac(1)).toBe(0));
  it("clamps above 20000 Hz", () => expect(freqToXFrac(30000)).toBe(1));
  it("1 kHz falls at ~56.6% on a log scale", () => {
    expect(freqToXFrac(1000)).toBeCloseTo(0.566, 2);
  });
  it("is monotonically increasing", () => {
    expect(freqToXFrac(100)).toBeLessThan(freqToXFrac(1000));
    expect(freqToXFrac(1000)).toBeLessThan(freqToXFrac(10000));
  });
});

describe("buildRtaBands", () => {
  it("returns at least one band for a valid range", () => {
    expect(buildRtaBands(20, 20000, "1/3").length).toBeGreaterThan(0);
  });
  it("each band satisfies fLow <= fCenter <= fHigh with positive width", () => {
    for (const b of buildRtaBands(20, 20000, "1/6")) {
      expect(b.fLow).toBeLessThanOrEqual(b.fCenter);
      expect(b.fCenter).toBeLessThanOrEqual(b.fHigh);
      expect(b.fLow).toBeLessThan(b.fHigh);
    }
  });
  it("finer resolution produces more bands than coarser", () => {
    const coarse = buildRtaBands(20, 20000, "1/3");
    const fine = buildRtaBands(20, 20000, "1/24");
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
  it("band edges stay within the requested range", () => {
    const bands = buildRtaBands(20, 20000, "1/3");
    expect(bands[0].fLow).toBeGreaterThanOrEqual(20);
    expect(bands[bands.length - 1].fHigh).toBeLessThanOrEqual(20001);
  });
});

describe("getWeightingDb", () => {
  it("Z-weighting always returns 0", () => {
    expect(getWeightingDb(100, "z")).toBe(0);
    expect(getWeightingDb(1000, "z")).toBe(0);
    expect(getWeightingDb(10000, "z")).toBe(0);
  });
  it("A-weighting at 1 kHz is approximately 0 dB (reference point)", () => {
    expect(getWeightingDb(1000, "a")).toBeCloseTo(0, 1);
  });
  it("A-weighting significantly attenuates low frequencies", () => {
    expect(getWeightingDb(100, "a")).toBeLessThan(-10);
  });
  it("C-weighting at 1 kHz is approximately 0 dB", () => {
    expect(getWeightingDb(1000, "c")).toBeCloseTo(0, 0);
  });
  it("defaults to Z-weighting for unknown mode", () => {
    expect(getWeightingDb(1000, "xyz")).toBe(0);
  });
});
