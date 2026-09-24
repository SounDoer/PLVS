import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  analyzeThemeVisuals,
  themeColorDistance,
  themeContrastRatio,
} from "./themeVisualAnalysis.js";

describe("Theme visual analysis", () => {
  it("reports structured, actionable warnings without mutating the document", () => {
    const theme = structuredClone(BUILTIN_THEMES_V2["plvs-light"]);
    theme.palettes.interface.warning = "#fbbf24";
    theme.overrides["interface.surface.control"] = { kind: "color", value: "#e5e1de" };
    theme.overrides["interface.surface.muted"] = { kind: "color", value: "#e5e1de" };
    const before = structuredClone(theme);
    const report = analyzeThemeVisuals(theme);

    expect(theme).toEqual(before);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "contrast",
          target: { page: "advanced", id: "interface.feedback.warning" },
          metric: expect.objectContaining({ label: "Contrast", target: 3 }),
        }),
        expect.objectContaining({ code: "surfaceCollision", section: "Interface" }),
      ])
    );
    expect(new Set(report.warnings.map((item) => item.id)).size).toBe(report.warnings.length);
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))("ships %s without high-confidence warnings", (id) => {
    expect(analyzeThemeVisuals(BUILTIN_THEMES_V2[id]).warnings).toEqual([]);
  });

  it("uses stable contrast and perceptual distance measurements", () => {
    expect(themeContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(themeColorDistance("#123456", "#123456")).toBe(0);
    expect(themeColorDistance("#000000", "#ffffff")).toBeGreaterThan(0.9);
  });
});
