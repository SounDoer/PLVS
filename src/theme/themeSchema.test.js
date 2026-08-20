import { describe, expect, it } from "vitest";

import { applyPalettePreset } from "./palettePresets.js";
import { isThemeV2, normalizeThemeName, normalizeThemeV2 } from "./themeSchema.js";

function validTheme(overrides = {}) {
  return {
    version: 2,
    id: "custom.sunrise",
    name: "Sunrise",
    colorScheme: "light",
    core: {
      workspace: "#fff",
      surface: "rgb(250, 250, 250)",
      text: "oklch(20% 0 0)",
      interfaceAccent: "#fb923c",
      primaryData: "#f97316",
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

describe("normalizeThemeV2", () => {
  it("normalizes the persisted authoring shape deterministically", () => {
    const raw = validTheme({
      name: "  Sunrise  ",
      overrides: {
        "waveform.centroid": { kind: "color", value: "RGB(255, 255, 255)" },
        "spectrum.primary": { kind: "reference", source: "core.secondaryData" },
        "interface.border.default": { kind: "effect", color: "#fff", opacity: 0.09 },
      },
      ignored: true,
    });

    expect(normalizeThemeV2(raw)).toEqual({
      version: 2,
      id: "custom.sunrise",
      name: "Sunrise",
      colorScheme: "light",
      core: {
        workspace: "#ffffff",
        surface: "#fafafa",
        text: "#161616",
        interfaceAccent: "#fb923c",
        primaryData: "#f97316",
        secondaryData: "#38bdf8",
      },
      palettes: {
        ...raw.palettes,
        interface: { presetId: null, critical: raw.palettes.status.critical },
      },
      overrides: {
        "waveform.centroid": { kind: "color", value: "#ffffff" },
        "spectrum.primary": { kind: "reference", source: "core.secondaryData" },
        "interface.border.default": { kind: "effect", color: "#ffffff", opacity: 0.09 },
      },
    });
  });

  it("seeds the interface palette from status critical when a document predates it", () => {
    const raw = validTheme();
    raw.palettes.status.critical = "#d03535";
    delete raw.palettes.interface;
    expect(normalizeThemeV2(raw)?.palettes.interface).toEqual({
      presetId: null,
      critical: "#d03535",
    });
  });

  it("keeps an interface critical that differs from the status one", () => {
    const raw = validTheme();
    raw.palettes.status.critical = "#d03535";
    raw.palettes.interface = { critical: "#df202e" };
    expect(normalizeThemeV2(raw)?.palettes.interface.critical).toBe("#df202e");
    expect(normalizeThemeV2(raw)?.palettes.status.critical).toBe("#d03535");
  });

  it("rejects a present but malformed interface palette", () => {
    const raw = validTheme();
    raw.palettes.interface = { critical: "not a color" };
    expect(normalizeThemeV2(raw)).toBeNull();
  });

  it("allows an unknown preset ID because palette values are saved snapshots", () => {
    const raw = validTheme();
    raw.palettes.status.presetId = "status-future";
    expect(normalizeThemeV2(raw)?.palettes.status.presetId).toBe("status-future");
  });

  it.each([
    ["wrong version", { version: 1 }],
    ["invalid ID", { id: "bad id" }],
    ["invalid scheme", { colorScheme: "system" }],
    ["empty name", { name: "   " }],
    ["missing core role", { core: { workspace: "#000000" } }],
  ])("rejects %s", (_label, override) => {
    expect(normalizeThemeV2(validTheme(override))).toBeNull();
  });

  it("rejects alpha-bearing identity colors", () => {
    const raw = validTheme();
    raw.core.workspace = "rgb(0 0 0 / 0.5)";
    expect(normalizeThemeV2(raw)).toBeNull();
  });

  it.each([
    [
      [
        { position: 0.1, color: "#000" },
        { position: 1, color: "#fff" },
      ],
    ],
    [
      [
        { position: 0, color: "#000" },
        { position: 0, color: "#fff" },
      ],
    ],
    [
      [
        { position: 0, color: "#000" },
        { position: 0.7, color: "#fff" },
      ],
    ],
    [[{ position: 0, color: "#000" }]],
  ])("rejects invalid Intensity stops", (stops) => {
    const raw = validTheme();
    raw.palettes.intensity.stops = stops;
    expect(normalizeThemeV2(raw)).toBeNull();
  });

  it("rejects malformed overrides", () => {
    expect(
      normalizeThemeV2(validTheme({ overrides: { "waveform.centroid": { kind: "magic" } } }))
    ).toBeNull();
  });

  it("provides a boolean version guard", () => {
    expect(isThemeV2(validTheme())).toBe(true);
    expect(isThemeV2({ version: 2 })).toBe(false);
  });
});

describe("normalizeThemeName", () => {
  it("enforces the persisted name boundary", () => {
    expect(normalizeThemeName("  Custom  ")).toBe("Custom");
    expect(normalizeThemeName("x".repeat(65))).toBeNull();
  });
});
