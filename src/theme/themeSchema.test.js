import { describe, expect, it } from "vitest";

import { applyPalettePreset } from "./palettePresets.js";
import {
  isCurrentThemeDocument,
  normalizeThemeDocumentShape,
  normalizeThemeName,
} from "./themeSchema.js";

function validTheme(overrides = {}) {
  return {
    formatVersion: 2,
    semanticsVersion: 1,
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
      interface: {
        presetId: null,
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f94144",
      },
    },
    overrides: {},
    ...overrides,
  };
}

describe("normalizeThemeDocumentShape", () => {
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

    expect(normalizeThemeDocumentShape(raw)).toEqual({
      formatVersion: 2,
      semanticsVersion: 1,
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
      },
      overrides: {
        "waveform.centroid": { kind: "color", value: "#ffffff" },
        "spectrum.primary": { kind: "reference", source: "core.secondaryData" },
        "interface.border.default": { kind: "effect", color: "#ffffff", opacity: 0.09 },
      },
    });
  });

  it("does not invent a missing interface palette", () => {
    const raw = validTheme();
    raw.palettes.status.critical = "#d03535";
    delete raw.palettes.interface;
    expect(normalizeThemeDocumentShape(raw)).toBeNull();
  });

  it("keeps Interface Danger independent from measurement Critical", () => {
    const raw = validTheme();
    raw.palettes.status.critical = "#d03535";
    raw.palettes.interface = {
      presetId: null,
      success: "#18976a",
      warning: "#b26a00",
      danger: "#df202e",
    };
    expect(normalizeThemeDocumentShape(raw)?.palettes.interface.danger).toBe("#df202e");
    expect(normalizeThemeDocumentShape(raw)?.palettes.status.critical).toBe("#d03535");
  });

  it("rejects a present but malformed interface palette", () => {
    const raw = validTheme();
    raw.palettes.interface = {
      presetId: null,
      success: "#18976a",
      warning: "#b26a00",
      danger: "not a color",
    };
    expect(normalizeThemeDocumentShape(raw)).toBeNull();
  });

  it("allows an unknown preset ID because palette values are saved snapshots", () => {
    const raw = validTheme();
    raw.palettes.status.presetId = "status-future";
    expect(normalizeThemeDocumentShape(raw)?.palettes.status.presetId).toBe("status-future");
  });

  it.each([
    ["wrong format version", { formatVersion: 3 }],
    ["wrong semantics version", { semanticsVersion: 2 }],
    ["invalid ID", { id: "bad id" }],
    ["invalid scheme", { colorScheme: "system" }],
    ["empty name", { name: "   " }],
    ["missing core role", { core: { workspace: "#000000" } }],
  ])("rejects %s", (_label, override) => {
    expect(normalizeThemeDocumentShape(validTheme(override))).toBeNull();
  });

  it("rejects alpha-bearing identity colors", () => {
    const raw = validTheme();
    raw.core.workspace = "rgb(0 0 0 / 0.5)";
    expect(normalizeThemeDocumentShape(raw)).toBeNull();
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
    expect(normalizeThemeDocumentShape(raw)).toBeNull();
  });

  it("rejects malformed overrides", () => {
    expect(
      normalizeThemeDocumentShape(
        validTheme({ overrides: { "waveform.centroid": { kind: "magic" } } })
      )
    ).toBeNull();
  });

  it("provides a boolean version guard", () => {
    expect(isCurrentThemeDocument(validTheme())).toBe(true);
    expect(isCurrentThemeDocument({ formatVersion: 2, semanticsVersion: 1 })).toBe(false);
  });
});

describe("normalizeThemeName", () => {
  it("enforces the persisted name boundary", () => {
    expect(normalizeThemeName("  Custom  ")).toBe("Custom");
    expect(normalizeThemeName("x".repeat(65))).toBeNull();
  });
});
