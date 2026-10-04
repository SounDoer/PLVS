import { applyPalettePreset } from "./palettePresets.js";

export const DEFAULT_THEME_ID = "plvs-dark";
export const THEME_IDS = Object.freeze(["plvs-dark", "plvs-light"]);

export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(id);
}

function makeBuiltin({ id, name, colorScheme, core, status, interfacePalette, frequency }) {
  return {
    formatVersion: 2,
    semanticsVersion: 3,
    id,
    name,
    colorScheme,
    core,
    palettes: {
      status: { presetId: "status-plvs", ...status },
      intensity: applyPalettePreset("intensity", "intensity-inferno"),
      frequency: { presetId: "frequency-plvs", ...frequency },
      interface: {
        presetId: null,
        ...interfacePalette,
      },
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
      interfaceAccent: "#b35300",
      primaryData: "#fb923c",
      secondaryData: "#209bda",
    },
    status: { safe: "#34d399", warning: "#fbbf24", critical: "#f97373" },
    interfacePalette: { success: "#147a54", warning: "#936000", danger: "#b83238" },
    frequency: { low: "#ff2d3d", mid: "#fb923c", high: "#356dff" },
  }),
  "plvs-light": makeBuiltin({
    id: "plvs-light",
    name: "Light",
    colorScheme: "light",
    core: {
      workspace: "#e9e5e2",
      surface: "#fdf9f6",
      text: "#140e0a",
      interfaceAccent: "#c45f13",
      primaryData: "#d16718",
      secondaryData: "#0e7490",
    },
    status: { safe: "#18976a", warning: "#9f6200", critical: "#d03535" },
    interfacePalette: { success: "#1a9064", warning: "#b17000", danger: "#e43b46" },
    frequency: { low: "#d9481c", mid: "#c06f00", high: "#3730a3" },
  }),
});

export function getBuiltinThemeV2(id) {
  return BUILTIN_THEMES_V2[id] ?? BUILTIN_THEMES_V2["plvs-dark"];
}
