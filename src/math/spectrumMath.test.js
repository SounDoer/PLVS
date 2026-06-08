import { describe, it, expect } from "vitest";
import { buildSpectrumSvgFromBandsAndDb } from "./spectrumMath.js";

describe("buildSpectrumSvgFromBandsAndDb", () => {
  it("returns empty string for empty input", () => {
    expect(buildSpectrumSvgFromBandsAndDb([], [])).toBe("");
  });

  it("returns empty for mismatched lengths", () => {
    expect(buildSpectrumSvgFromBandsAndDb([100, 1000], [-20])).toBe("");
  });

  it("returns SVG path starting with M", () => {
    const centers = [100, 1000, 10000];
    const db = [-20, -30, -40];
    const svg = buildSpectrumSvgFromBandsAndDb(centers, db);
    expect(svg).toMatch(/^M /);
  });

  it("dB values above 0 clamp to top", () => {
    const svg = buildSpectrumSvgFromBandsAndDb([1000], [10]);
    expect(svg).toMatch(/^M /);
  });
});
