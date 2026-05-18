import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, THEME_IDS, getBuiltinTheme } from "./builtinThemes.js";

describe("BUILTIN_THEMES", () => {
  it("contains plvs-dark, plvs-light, plvs-phosphor, and plvs-tungsten", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).toContain("plvs-phosphor");
    expect(THEME_IDS).toContain("plvs-tungsten");
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
