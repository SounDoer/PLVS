/**
 * Builtin colour themes.
 * @typedef {"plvs-dark" | "plvs-light"} ThemeId
 */

import { PLVS_SEMANTIC_DARK, PLVS_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";

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
 * }} BuiltinTheme
 */

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("plvs-dark");

const CHARTS_PLVS_DARK = {
  loudnessHistory: {
    momentaryStroke: "#fb923c",
    momentaryStrokeSnap: "#fcd34d",
    momentaryStrokeWidth: 1.2,
    shortTermStroke: "#e8824a",
    shortTermStrokeSnap: "#fed7aa",
    shortTermStrokeWidth: 1.2,
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
    momentaryStrokeSnap: "#c07820",
    momentaryStrokeWidth: 1.2,
    shortTermStroke: "#c86030",
    shortTermStrokeSnap: "#b08050",
    shortTermStrokeWidth: 1.2,
    shortTermOpacity: 0.95,
    selectionStroke: "#c07820",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 20%, transparent)",
  },
  vectorscope: {
    strokeLive: "#e07020",
    strokeSnap: "#c07820",
    strokeWidth: 1,
    axisOpacity: 0.6,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#e07020",
    strokeSnap: "#c07820",
    strokeWidth: 1.5,
    fillOpacityTop: 0.18,
    fillOpacityBottom: 0.03,
  },
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
};

/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(/** @type {ThemeId[]} */ (["plvs-dark", "plvs-light"]));

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
