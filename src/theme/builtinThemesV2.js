const INFERNO_STOPS = [
  [0, "#000004"],
  [26, "#1e0c2f"],
  [51, "#420f6e"],
  [77, "#710c8c"],
  [102, "#9e0c8f"],
  [128, "#cb197f"],
  [153, "#e74152"],
  [179, "#f5821e"],
  [204, "#fbc40a"],
  [230, "#fceb64"],
  [255, "#fcffa4"],
].map(([position, color]) => ({ position: position / 255, color }));

export const DEFAULT_THEME_ID = "plvs-dark";
export const THEME_IDS = Object.freeze(["plvs-dark", "plvs-light"]);

export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(id);
}

function makeBuiltin({ id, name, colorScheme, core, status, frequency, overrides }) {
  return {
    version: 2,
    id,
    name,
    colorScheme,
    core,
    palettes: {
      status: { presetId: "status-plvs", ...status },
      intensity: { presetId: "intensity-inferno", stops: INFERNO_STOPS },
      frequency: { presetId: "frequency-plvs", ...frequency },
    },
    overrides,
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
      surface: "#151515",
      text: "#f2f2f2",
      interfaceAccent: "#fb923c",
      primaryData: "#fb923c",
      secondaryData: "#38bdf8",
    },
    status: { good: "#34d399", warning: "#fbbf24", critical: "#f97373" },
    frequency: { low: "#ff2d3d", mid: "#fb923c", high: "#356dff" },
    overrides: {
      "interface.surface.raised": { kind: "color", value: "#151515" },
      "interface.surface.control": { kind: "color", value: "#232323" },
      "interface.surface.muted": { kind: "color", value: "#232323" },
      "interface.surface.interactive": { kind: "color", value: "#232323" },
      "interface.text.secondary": { kind: "color", value: "#898989" },
      "interface.content.onAccent": { kind: "color", value: "#070707" },
      "interface.content.onCritical": { kind: "color", value: "#fafafa" },
      "interface.critical": { kind: "color", value: "#f94144" },
      "waveform.frequencyNeutral": { kind: "color", value: "#484850" },
      "waveform.centroid": { kind: "color", value: "#f8fafc" },
      "spectrogram.ink": { kind: "color", value: "#898989" },
      "spectrogram.grid": { kind: "color", value: "#898989" },
    },
  }),
  "plvs-light": makeBuiltin({
    id: "plvs-light",
    name: "Light",
    colorScheme: "light",
    core: {
      workspace: "#fbf8f5",
      surface: "#f5f1ee",
      text: "#140e0a",
      interfaceAccent: "#e07020",
      primaryData: "#e07020",
      secondaryData: "#0e7490",
    },
    status: { good: "#18976a", warning: "#fbbf24", critical: "#d03535" },
    frequency: { low: "#d9481c", mid: "#a21caf", high: "#3730a3" },
    overrides: {
      "interface.surface.raised": { kind: "color", value: "#f5f1ee" },
      "interface.surface.control": { kind: "color", value: "#e5e0dc" },
      "interface.surface.muted": { kind: "color", value: "#e5e0dc" },
      "interface.surface.interactive": { kind: "color", value: "#e5e0dc" },
      "interface.text.secondary": { kind: "color", value: "#6a615b" },
      "interface.content.onAccent": { kind: "color", value: "#140e0a" },
      "interface.content.onCritical": { kind: "color", value: "#fafafa" },
      "interface.critical": { kind: "color", value: "#df202e" },
      "waveform.frequencyNeutral": { kind: "color", value: "#737373" },
      "waveform.centroid": { kind: "color", value: "#111827" },
      "spectrogram.ink": { kind: "color", value: "#6a615b" },
      "spectrogram.grid": { kind: "color", value: "#6a615b" },
    },
  }),
});

export function getBuiltinThemeV2(id) {
  return BUILTIN_THEMES_V2[id] ?? BUILTIN_THEMES_V2["plvs-dark"];
}
