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
 *   midStopPercent: number;
 * }} MeterGradient
 */

/**
 * @typedef {{
 *   accent: string;
 *   accentSecondary: string;
 *   signal: { good: string; warn: string; bad: string };
 * }} ThemeSeeds
 */

/**
 * @typedef {{
 *   id: ThemeId;
 *   label: string;
 *   semantic: ShadcnSemantic;
 *   charts: ChartsBundle;
 *   meterGradient: MeterGradient;
 *   colorScheme: "light" | "dark";
 *   seeds: ThemeSeeds;
 * }} BuiltinTheme
 */

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("plvs-dark");

const CHARTS_PLVS_DARK = {
  loudnessHistory: {
    momentaryStrokeWidth: 1.1,
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.95,
    selectionStrokeWidth: 1.2,
  },
  vectorscope: {
    strokeWidth: 1,
    axisOpacity: 0.8,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeWidth: 1.5,
    fillOpacityTop: 0.22,
    fillOpacityBottom: 0.03,
  },
  waveform: {
    fillOpacity: 0.22,
    strokeWidth: 1,
  },
};

const METER_GRADIENT_PLVS = { midStopPercent: 46 };

const CHARTS_PLVS_LIGHT = {
  loudnessHistory: {
    momentaryStrokeWidth: 1.1,
    shortTermStrokeWidth: 2.1,
    shortTermOpacity: 0.95,
    selectionStrokeWidth: 1.2,
  },
  vectorscope: {
    strokeWidth: 1,
    axisOpacity: 0.6,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeWidth: 1.5,
    fillOpacityTop: 0.18,
    fillOpacityBottom: 0.03,
  },
  waveform: {
    fillOpacity: 0.22,
    strokeWidth: 1,
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
    seeds: {
      accent: "#fb923c",
      accentSecondary: "#38bdf8",
      signal: { good: "#34d399", warn: "#fbbf24", bad: "#f97373" },
    },
  },
  "plvs-light": {
    id: "plvs-light",
    label: "Light",
    semantic: PLVS_SEMANTIC_LIGHT,
    charts: CHARTS_PLVS_LIGHT,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "light",
    seeds: {
      accent: "#e07020",
      accentSecondary: "#0e7490",
      signal: { good: "#18976a", warn: "#fbbf24", bad: "#d03535" },
    },
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
