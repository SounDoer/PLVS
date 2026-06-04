/**
 * Builtin colour themes.
 * @typedef {"plvs-dark" | "plvs-light" | "plvs-phosphor" | "plvs-tungsten" | "plvs-abyss"} ThemeId
 */

import {
  PLVS_SEMANTIC_ABYSS,
  PLVS_SEMANTIC_DARK,
  PLVS_SEMANTIC_LIGHT,
  PLVS_SEMANTIC_PHOSPHOR,
  PLVS_SEMANTIC_TUNGSTEN,
} from "./shadcnSemanticPreset.js";

/** @typedef {import("./shadcnSemanticPreset.js").ShadcnSemantic} ShadcnSemantic */

/**
 * @typedef {{
 *   loudnessHistory: Record<string, unknown>;
 *   vectorscope: Record<string, unknown>;
 *   spectrum: Record<string, unknown>;
 * }} ChartsBundle
 */

/**
 * @typedef {{
 *   top: string;
 *   mid: string;
 *   midStopPercent: number;
 *   bottom: string;
 * }} MeterGradient
 */

/**
 * @typedef {{
 *   id: ThemeId;
 *   label: string;
 *   semantic: ShadcnSemantic;
 *   charts: ChartsBundle;
 *   meterGradient: MeterGradient;
 *   colorScheme: "light" | "dark";
 *   meterColorOverrides?: Record<string, unknown>;
 * }} BuiltinTheme
 */

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("plvs-dark");

const CHARTS_PLVS_DARK = {
  loudnessHistory: {
    momentaryStroke: "#fb923c",
    momentaryStrokeSnap: "#fcd34d",
    momentaryStrokeWidth: 1.1,
    shortTermStroke: "#c66a2a",
    shortTermStrokeSnap: "#f2b27a",
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.95,
    selectionStroke: "#fcd34d",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 10%, transparent)",
  },
  vectorscope: {
    strokeLive: "#fb923c",
    strokeSnap: "#fcd34d",
    strokeWidth: 1,
    axisOpacity: 0.8,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#fb923c",
    strokeSnap: "#fcd34d",
    strokeWidth: 1.5,
    fillOpacityTop: 0.22,
    fillOpacityBottom: 0.03,
  },
};

const METER_GRADIENT_PLVS = {
  top: "#f97373",
  mid: "#fbbf24",
  midStopPercent: 46,
  bottom: "#34d399",
};

const CHARTS_PLVS_LIGHT = {
  loudnessHistory: {
    momentaryStroke: "#e07020",
    momentaryStrokeSnap: "#b76b00",
    momentaryStrokeWidth: 1.1,
    shortTermStroke: "#a85224",
    shortTermStrokeSnap: "#7a5a18",
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.95,
    selectionStroke: "#c07820",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 20%, transparent)",
  },
  vectorscope: {
    strokeLive: "#e07020",
    strokeSnap: "#b76b00",
    strokeWidth: 1,
    axisOpacity: 0.6,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#e07020",
    strokeSnap: "#b76b00",
    strokeWidth: 1.5,
    fillOpacityTop: 0.18,
    fillOpacityBottom: 0.03,
  },
};

const CHARTS_PLVS_PHOSPHOR = {
  loudnessHistory: {
    momentaryStroke: "#2cff65",
    momentaryStrokeSnap: "#9ed4aa",
    momentaryStrokeWidth: 1.1,
    shortTermStroke: "#1bcc4e",
    shortTermStrokeSnap: "#6db87e",
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.85,
    selectionStroke: "#9ed4aa",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 15%, transparent)",
  },
  vectorscope: {
    strokeLive: "#2cff65",
    strokeSnap: "#9ed4aa",
    strokeWidth: 1,
    axisOpacity: 0.7,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#2cff65",
    strokeSnap: "#9ed4aa",
    strokeWidth: 1.5,
    fillOpacityTop: 0.2,
    fillOpacityBottom: 0.02,
  },
};

const METER_GRADIENT_PHOSPHOR = {
  top: "#ff3030",
  mid: "#ffaa00",
  midStopPercent: 46,
  bottom: "#2cff65",
};

const METER_COLOR_OVERRIDES_PHOSPHOR = {
  peakSamplePeak: "#2cff65",
  peakTruePeak: "#ff3030",
  tpMaxText: "#ff3030",
  correlation: { bad: "#ff3030", mid: "#4d8a5c", good: "#2cff65" },
  metricRowBg: "rgba(44,255,101,0.03)",
  metricRowHoverBg: "rgba(44,255,101,0.07)",
  metricRowToggleOnBorder: "rgba(44,255,101,0.30)",
  metricRowToggleOnBg: "rgba(44,255,101,0.09)",
  metricRowToggleOnGlow: "rgba(44,255,101,0.20)",
  metricToggleOnLabel: "#2cff65",
  loudnessTargetLine: "rgba(44,255,101,0.35)",
};

const CHARTS_PLVS_ABYSS = {
  loudnessHistory: {
    momentaryStroke: "#ff5040",
    momentaryStrokeSnap: "#28c4cc",
    momentaryStrokeWidth: 1.1,
    shortTermStroke: "#cc3828",
    shortTermStrokeSnap: "#1a9098",
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.7,
    selectionStroke: "#28c4cc",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 15%, transparent)",
  },
  vectorscope: {
    strokeLive: "#ff5040",
    strokeSnap: "#28c4cc",
    strokeWidth: 1,
    axisOpacity: 0.6,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#ff5040",
    strokeSnap: "#28c4cc",
    strokeWidth: 1.5,
    fillOpacityTop: 0.18,
    fillOpacityBottom: 0.02,
  },
};

const METER_GRADIENT_ABYSS = {
  top: "#ff1800",
  mid: "#ff5040",
  midStopPercent: 46,
  bottom: "#28c4cc",
};

const METER_COLOR_OVERRIDES_ABYSS = {
  peakSamplePeak: "#ff5040",
  peakTruePeak: "#ff1800",
  tpMaxText: "#ff1800",
  correlation: { bad: "#ff1800", mid: "#166872", good: "#28c4cc" },
  metricRowBg: "rgba(0,195,210,0.03)",
  metricRowHoverBg: "rgba(0,195,210,0.07)",
  metricRowToggleOnBorder: "rgba(255,80,64,0.28)",
  metricRowToggleOnBg: "rgba(255,80,64,0.08)",
  metricRowToggleOnGlow: "rgba(255,80,64,0.18)",
  metricToggleOnLabel: "#ff5040",
  loudnessTargetLine: "rgba(255,80,64,0.35)",
};

const CHARTS_PLVS_TUNGSTEN = {
  loudnessHistory: {
    momentaryStroke: "#ffaa00",
    momentaryStrokeSnap: "#ffd060",
    momentaryStrokeWidth: 1.1,
    shortTermStroke: "#c07820",
    shortTermStrokeSnap: "#f4b84a",
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.85,
    selectionStroke: "#ffd060",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 15%, transparent)",
  },
  vectorscope: {
    strokeLive: "#ffaa00",
    strokeSnap: "#ffd060",
    strokeWidth: 1,
    axisOpacity: 0.6,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#ffaa00",
    strokeSnap: "#ffd060",
    strokeWidth: 1.5,
    fillOpacityTop: 0.18,
    fillOpacityBottom: 0.02,
  },
};

const METER_GRADIENT_TUNGSTEN = {
  top: "#ff2200",
  mid: "#ffa000",
  midStopPercent: 46,
  bottom: "#c8a020",
};

const METER_COLOR_OVERRIDES_TUNGSTEN = {
  peakSamplePeak: "#ffaa00",
  peakTruePeak: "#ff2200",
  tpMaxText: "#ff2200",
  correlation: { bad: "#ff4010", mid: "#8a6030", good: "#a0a020" },
  metricRowBg: "rgba(255,150,0,0.03)",
  metricRowHoverBg: "rgba(255,150,0,0.07)",
  metricRowToggleOnBorder: "rgba(255,150,0,0.28)",
  metricRowToggleOnBg: "rgba(255,150,0,0.08)",
  metricRowToggleOnGlow: "rgba(255,150,0,0.18)",
  metricToggleOnLabel: "#ffaa00",
  loudnessTargetLine: "rgba(255,150,0,0.35)",
};

/** @type {Record<ThemeId, BuiltinTheme>} */
export const BUILTIN_THEMES = {
  "plvs-dark": {
    id: "plvs-dark",
    label: "Dark",
    semantic: PLVS_SEMANTIC_DARK,
    charts: CHARTS_PLVS_DARK,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "dark",
  },
  "plvs-light": {
    id: "plvs-light",
    label: "Light",
    semantic: PLVS_SEMANTIC_LIGHT,
    charts: CHARTS_PLVS_LIGHT,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "light",
  },
  "plvs-phosphor": {
    id: "plvs-phosphor",
    label: "Phosphor",
    semantic: PLVS_SEMANTIC_PHOSPHOR,
    charts: CHARTS_PLVS_PHOSPHOR,
    meterGradient: METER_GRADIENT_PHOSPHOR,
    colorScheme: "dark",
    meterColorOverrides: METER_COLOR_OVERRIDES_PHOSPHOR,
  },
  "plvs-tungsten": {
    id: "plvs-tungsten",
    label: "Tungsten",
    semantic: PLVS_SEMANTIC_TUNGSTEN,
    charts: CHARTS_PLVS_TUNGSTEN,
    meterGradient: METER_GRADIENT_TUNGSTEN,
    colorScheme: "dark",
    meterColorOverrides: METER_COLOR_OVERRIDES_TUNGSTEN,
  },
  "plvs-abyss": {
    id: "plvs-abyss",
    label: "Abyss",
    semantic: PLVS_SEMANTIC_ABYSS,
    charts: CHARTS_PLVS_ABYSS,
    meterGradient: METER_GRADIENT_ABYSS,
    colorScheme: "dark",
    meterColorOverrides: METER_COLOR_OVERRIDES_ABYSS,
  },
};

/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(
  /** @type {ThemeId[]} */ ([
    "plvs-dark",
    "plvs-light",
    "plvs-phosphor",
    "plvs-tungsten",
    "plvs-abyss",
  ])
);

/**
 * @param {unknown} id
 * @returns {id is ThemeId}
 */
export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(/** @type {ThemeId} */ (id));
}

export const THEME_SELECT_OPTIONS = Object.freeze(
  THEME_IDS.map((id) => ({ id, label: BUILTIN_THEMES[id].label }))
);

/**
 * @param {ThemeId} id
 * @returns {BuiltinTheme}
 */
export function getBuiltinTheme(id) {
  return BUILTIN_THEMES[id] ?? BUILTIN_THEMES[DEFAULT_THEME_ID];
}
