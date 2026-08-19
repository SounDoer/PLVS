import { describe, expect, it } from "vitest";

import { compileTheme } from "./compileTheme.js";
import { applyPalettePreset } from "./palettePresets.js";
import { THEME_ROLE_REGISTRY } from "./themeRoleRegistry.js";

function authoringTheme(overrides = {}) {
  return {
    version: 2,
    id: "test-theme",
    name: "Test Theme",
    colorScheme: "dark",
    core: {
      workspace: "#070707",
      surface: "#151515",
      text: "#f2f2f2",
      interfaceAccent: "#fb923c",
      primaryData: "#fb923c",
      secondaryData: "#38bdf8",
    },
    palettes: {
      status: applyPalettePreset("status", "status-plvs"),
      intensity: applyPalettePreset("intensity", "intensity-inferno"),
      frequency: applyPalettePreset("frequency", "frequency-plvs"),
    },
    overrides: {},
    ...overrides,
  };
}

describe("compileTheme", () => {
  it("resolves every registered role and publication binding", () => {
    const resolved = compileTheme(authoringTheme());

    expect(Object.keys(resolved.roles)).toHaveLength(THEME_ROLE_REGISTRY.length);
    for (const entry of THEME_ROLE_REGISTRY) {
      expect(resolved.roles[entry.id], entry.id).toBeDefined();
      for (const binding of entry.bindings.css ?? []) expect(resolved.css[binding]).toBeDefined();
      for (const binding of entry.bindings.canvas ?? []) {
        expect(resolved.canvas[binding]).toBeDefined();
      }
    }
    expect(resolved.native).toEqual({ colorScheme: "dark" });
  });

  it("is deterministic and returns no shared mutable palette data", () => {
    const input = authoringTheme();
    const first = compileTheme(input, { revision: 7 });
    const second = compileTheme(input, { revision: 7 });

    expect(first).toEqual(second);
    first.roles["palette.intensity.stops"][0].color = "#ffffff";
    expect(second.roles["palette.intensity.stops"][0].color).toBe("#000004");
    expect(input.palettes.intensity.stops[0].color).toBe("#000004");
  });

  it("keeps Interface Accent independent from Primary Data", () => {
    const theme = authoringTheme();
    theme.core.interfaceAccent = "#ff0000";
    theme.core.primaryData = "#00ff00";
    const resolved = compileTheme(theme);

    expect(resolved.css["--primary"]).toBe("#ff0000");
    expect(resolved.css["--ui-spectrum-primary"]).toBe("#00ff00");
  });

  it("publishes the Loudness grid instead of leaving an unresolved CSS variable", () => {
    const resolved = compileTheme(authoringTheme());

    expect(resolved.css["--ui-loudness-grid"]).toBe(resolved.roles["loudness.grid"]);
    expect(resolved.css["--ui-loudness-grid"]).toBe("#282828");
  });

  it("maps Status directly without deriving it from either accent", () => {
    const theme = authoringTheme();
    theme.core.interfaceAccent = "#000000";
    theme.core.primaryData = "#ffffff";
    theme.palettes.status = {
      presetId: null,
      good: "#112233",
      warning: "#445566",
      critical: "#778899",
    };
    const resolved = compileTheme(theme);

    expect(resolved.css["--ui-signal-good"]).toBe("#112233");
    expect(resolved.css["--ui-signal-warn"]).toBe("#445566");
    expect(resolved.css["--ui-signal-bad"]).toBe("#778899");
  });

  it("applies explicit colors and compatible references after automatic recipes", () => {
    const theme = authoringTheme({
      overrides: {
        "waveform.centroid": { kind: "color", value: "#123456" },
        "spectrum.primary": { kind: "reference", source: "core.secondaryData" },
      },
    });
    const resolved = compileTheme(theme);

    expect(resolved.css["--ui-waveform-centroid"]).toBe("#123456");
    expect(resolved.css["--ui-spectrum-primary"]).toBe("#38bdf8");
  });

  it("rejects unknown and incompatible Advanced overrides", () => {
    expect(() =>
      compileTheme(
        authoringTheme({ overrides: { "missing.role": { kind: "color", value: "#123456" } } })
      )
    ).toThrow("Unknown override role");

    expect(() =>
      compileTheme(
        authoringTheme({
          overrides: {
            "spectrum.primary": { kind: "reference", source: "palette.status.good" },
          },
        })
      )
    ).toThrow("is not compatible");
  });

  it("keeps effect opacity separate from its source color", () => {
    const resolved = compileTheme(authoringTheme());

    expect(resolved.effects["effect.scrim"]).toEqual({ color: "#070707", opacity: 0.72 });
    expect(resolved.css["--ui-effect-scrim"]).toBe("rgba(7, 7, 7, 0.72)");
  });

  it("supports explicit leaf effect overrides without making Core colors translucent", () => {
    const theme = authoringTheme({
      overrides: {
        "interface.border.default": { kind: "effect", color: "#112233", opacity: 0.25 },
      },
    });
    const resolved = compileTheme(theme);
    expect(resolved.roles["core.surface"]).toBe("#151515");
    expect(resolved.css["--border"]).toBe("rgba(17, 34, 51, 0.25)");
  });
});
