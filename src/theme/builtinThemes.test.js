import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, THEME_IDS, getBuiltinTheme } from "./builtinThemes.js";

describe("BUILTIN_THEMES", () => {
  it("contains plvs-dark, plvs-light, and plvs-phosphor", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).toContain("plvs-phosphor");
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
});
