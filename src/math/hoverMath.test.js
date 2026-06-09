import { describe, expect, it } from "vitest";
import {
  formatHoverOffset,
  formatSpectrumFreq,
  computeHistoryHoverPoint,
  computeSpectrumHoverIndex,
} from "./hoverMath";

const rect = (left, width) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0 });

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
    const idx = computeSpectrumHoverIndex(0, rect(0, 600), bands);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(bands.length);
  });

  it("returns an index within bounds for any x position", () => {
    for (const clientX of [0, 100, 300, 599, 600]) {
      const idx = computeSpectrumHoverIndex(clientX, rect(0, 600), bands);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(bands.length);
    }
  });
});
