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
    expect(report.communityPublication).toEqual({
      eligible: true,
      scope: "visualReviewOnly",
      blockers: [],
    });
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))(
    "analyzes built-in %s without making review a gate",
    (id) => {
      const report = analyzeThemeVisuals(BUILTIN_THEMES_V2[id]);
      expect(Array.isArray(report.warnings)).toBe(true);
      expect(report.communityPublication).toEqual({
        eligible: true,
        blockers: [],
        scope: "visualReviewOnly",
      });
    }
  );

  it("keeps covered WCAG text findings as non-blocking visual review", () => {
    const lowContrast = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    lowContrast.overrides["interface.text.annotation"] = { kind: "color", value: "#151515" };

    const report = analyzeThemeVisuals(lowContrast);

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        id: "contrast:interface.text.annotation+interface.surface.panel",
        code: "contrast",
        standard: "WCAG 2.2 SC 1.4.3",
        roleIds: ["interface.text.annotation", "interface.surface.panel"],
        metric: expect.objectContaining({ target: 4.5 }),
      })
    );
    expect(report.communityPublication).toEqual({
      eligible: true,
      blockers: [],
      scope: "visualReviewOnly",
    });
  });

  it("keeps the WCAG non-text threshold as non-blocking visual review", () => {
    const hiddenTrace = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    hiddenTrace.core.primaryData = hiddenTrace.core.surface;

    const report = analyzeThemeVisuals(hiddenTrace);

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        id: "contrast:data.primary+interface.surface.panel",
        standard: "WCAG 2.2 SC 1.4.11",
        metric: expect.objectContaining({ target: 3 }),
      })
    );
  });

  it("allows heuristic visual warnings through the community publication policy", () => {
    const closeStatusColors = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    closeStatusColors.palettes.status.safe = closeStatusColors.palettes.status.warning;

    const report = analyzeThemeVisuals(closeStatusColors);

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        code: "separation",
        roleIds: ["palette.status.safe", "palette.status.warning"],
        standard: null,
      })
    );
    expect(report.communityPublication).toEqual({
      eligible: true,
      blockers: [],
      scope: "visualReviewOnly",
    });
  });

  it("uses stable contrast and perceptual distance measurements", () => {
    expect(themeContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(themeColorDistance("#123456", "#123456")).toBe(0);
    expect(themeColorDistance("#000000", "#ffffff")).toBeGreaterThan(0.9);
  });
});
