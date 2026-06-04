import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, THEME_IDS, getBuiltinTheme } from "./builtinThemes.js";

function hexToRgb(hex) {
  const matched = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!matched) return null;

  const value = Number.parseInt(matched[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorDistance(a, b) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 0;

  return Math.hypot(rgbA.r - rgbB.r, rgbA.g - rgbB.g, rgbA.b - rgbB.b);
}

describe("BUILTIN_THEMES", () => {
  it("contains plvs-dark, plvs-light, plvs-phosphor, and plvs-tungsten", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).toContain("plvs-phosphor");
    expect(THEME_IDS).toContain("plvs-tungsten");
    expect(THEME_IDS).toContain("plvs-abyss");
  });

  it("defines distinct loudness history trace tokens for every theme", () => {
    for (const themeId of THEME_IDS) {
      const loudnessHistory = BUILTIN_THEMES[themeId].charts.loudnessHistory;

      expect(loudnessHistory.momentaryStroke).toBeTruthy();
      expect(loudnessHistory.momentaryStrokeSnap).toBeTruthy();
      expect(loudnessHistory.shortTermStroke).toBeTruthy();
      expect(loudnessHistory.shortTermStrokeSnap).toBeTruthy();
      expect(loudnessHistory.selectionStroke).toBeTruthy();
      expect(loudnessHistory.historyGridLineColor).toBeTruthy();

      expect(loudnessHistory.momentaryStroke).not.toBe(loudnessHistory.shortTermStroke);
      expect(Number(loudnessHistory.momentaryStrokeWidth)).toBeGreaterThan(0);
      expect(Number(loudnessHistory.shortTermStrokeWidth)).toBeGreaterThan(0);
      expect(
        Number(loudnessHistory.shortTermStrokeWidth) / Number(loudnessHistory.momentaryStrokeWidth)
      ).toBeGreaterThanOrEqual(1.75);
      expect(
        colorDistance(loudnessHistory.momentaryStroke, loudnessHistory.shortTermStroke)
      ).toBeGreaterThanOrEqual(45);
      expect(Number(loudnessHistory.shortTermOpacity)).toBeGreaterThan(0);
      expect(Number(loudnessHistory.shortTermOpacity)).toBeLessThanOrEqual(1);
    }
  });

  it("plvs-abyss has colorScheme dark", () => {
    expect(BUILTIN_THEMES["plvs-abyss"].colorScheme).toBe("dark");
  });

  it("plvs-abyss meterColorOverrides sets coral as toggle label", () => {
    const ov = BUILTIN_THEMES["plvs-abyss"].meterColorOverrides;
    expect(ov).toBeDefined();
    expect(ov.metricToggleOnLabel).toBe("#ff5040");
  });

  it("plvs-abyss meterColorOverrides uses cyan-tinted row backgrounds", () => {
    const ov = BUILTIN_THEMES["plvs-abyss"].meterColorOverrides;
    expect(ov.metricRowBg).toMatch(/rgba\(0,195,210/);
  });

  it("getBuiltinTheme returns plvs-abyss correctly", () => {
    expect(getBuiltinTheme("plvs-abyss").id).toBe("plvs-abyss");
    expect(getBuiltinTheme("plvs-abyss").label).toBe("Abyss");
  });

  it("plvs-phosphor has colorScheme dark", () => {
    expect(BUILTIN_THEMES["plvs-phosphor"].colorScheme).toBe("dark");
  });

  it("plvs-phosphor meterColorOverrides sets phosphor green as toggle label", () => {
    const ov = BUILTIN_THEMES["plvs-phosphor"].meterColorOverrides;
    expect(ov).toBeDefined();
    expect(ov.metricToggleOnLabel).toBe("#2cff65");
  });

  it("plvs-phosphor meterColorOverrides uses black-tinted row backgrounds", () => {
    const ov = BUILTIN_THEMES["plvs-phosphor"].meterColorOverrides;
    expect(ov.metricRowBg).toMatch(/rgba\(44,255,101/);
  });

  it("getBuiltinTheme returns plvs-phosphor correctly", () => {
    expect(getBuiltinTheme("plvs-phosphor").id).toBe("plvs-phosphor");
    expect(getBuiltinTheme("plvs-phosphor").label).toBe("Phosphor");
  });

  it("plvs-tungsten has colorScheme dark", () => {
    expect(BUILTIN_THEMES["plvs-tungsten"].colorScheme).toBe("dark");
  });

  it("plvs-tungsten meterColorOverrides sets amber as toggle label", () => {
    const ov = BUILTIN_THEMES["plvs-tungsten"].meterColorOverrides;
    expect(ov).toBeDefined();
    expect(ov.metricToggleOnLabel).toBe("#ffaa00");
  });

  it("plvs-tungsten meterColorOverrides uses amber-tinted row backgrounds", () => {
    const ov = BUILTIN_THEMES["plvs-tungsten"].meterColorOverrides;
    expect(ov.metricRowBg).toMatch(/rgba\(255/);
  });

  it("getBuiltinTheme returns plvs-tungsten correctly", () => {
    expect(getBuiltinTheme("plvs-tungsten").id).toBe("plvs-tungsten");
    expect(getBuiltinTheme("plvs-tungsten").label).toBe("Tungsten");
  });
});
