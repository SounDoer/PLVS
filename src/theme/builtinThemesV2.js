import { applyPalettePreset } from "./palettePresets.js";

export const DEFAULT_THEME_ID = "plvs-dark";
export const THEME_IDS = Object.freeze(["plvs-dark", "plvs-light"]);

export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(id);
}

function makeBuiltin({ id, name, colorScheme, core, statusPresetId, frequencyPresetId }) {
  return {
    formatVersion: 2,
    semanticsVersion: 4,
    id,
    name,
    colorScheme,
    core,
    palettes: {
      status: applyPalettePreset("status", statusPresetId),
      intensity: applyPalettePreset("intensity", "intensity-inferno"),
      frequency: applyPalettePreset("frequency", frequencyPresetId),
      interface: applyPalettePreset("interface", "interface-plvs"),
    },
    overrides: {},
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const BUILTIN_THEMES_V2 = deepFreeze({
  "plvs-dark": makeBuiltin({
    id: "plvs-dark",
    name: "Dark",
    colorScheme: "dark",
    core: {
      workspace: "#070707",
      surface: "#1c1c1c",
      text: "#f2f2f2",
      interfaceAccent: "#d97700",
      primaryData: "#d97700",
      secondaryData: "#008ad9",
    },
    statusPresetId: "status-plvs",
    frequencyPresetId: "frequency-plvs",
  }),
  "plvs-light": makeBuiltin({
    id: "plvs-light",
    name: "Light",
    colorScheme: "light",
    core: {
      workspace: "#efefef",
      surface: "#fdf9f6",
      text: "#282828",
      interfaceAccent: "#d97700",
      primaryData: "#d97700",
      secondaryData: "#008ad9",
    },
    statusPresetId: "status-plvs",
    frequencyPresetId: "frequency-plvs",
  }),
});

export function getBuiltinThemeV2(id) {
  return BUILTIN_THEMES_V2[id] ?? BUILTIN_THEMES_V2["plvs-dark"];
}
