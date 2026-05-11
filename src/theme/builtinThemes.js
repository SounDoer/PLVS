/**
 * Builtin colour themes (full token bundles per ADR 0002).
 * @typedef {"audiometer-dark"|"audiometer-light"|"audiometer-ember"} ThemeId
 */

import { AUDIOMETER_SEMANTIC_DARK, AUDIOMETER_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";

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

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("audiometer-dark");

/** Dark resolved charts (former module defaults + empty `themes.dark`). */
const CHARTS_DARK = {
  loudnessHistory: {
    momentaryStroke: "#22d3ee",
    momentaryStrokeSnap: "#fb923c",
    momentaryStrokeWidth: 1.2,
    shortTermStroke: "#007AFF",
    shortTermStrokeSnap: "#f59e0b",
    shortTermStrokeWidth: 1.2,
    shortTermOpacity: 0.95,
    selectionStroke: "#f59e0b",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--ui-color-divider) 10%, transparent)",
  },
  vectorscope: {
    strokeLive: "#007AFF",
    strokeSnap: "#f59e0b",
    strokeWidth: 1,
    axisOpacity: 0.8,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--ui-color-divider) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#007AFF",
    strokeSnap: "#f59e0b",
    strokeWidth: 1.5,
    fillOpacityTop: 0.22,
    fillOpacityBottom: 0.03,
  },
};

/** Light resolved charts (module defaults merged with former `themes.light.charts`). */
const CHARTS_LIGHT = {
  loudnessHistory: {
    ...CHARTS_DARK.loudnessHistory,
    momentaryStroke: "#0e7490",
    momentaryStrokeSnap: "#c2410c",
    shortTermStroke: "#1d4ed8",
    shortTermStrokeSnap: "#9a3412",
    selectionStroke: "#c2410c",
  },
  vectorscope: {
    ...CHARTS_DARK.vectorscope,
    strokeLive: "#1d4ed8",
    strokeSnap: "#c2410c",
  },
  spectrum: {
    ...CHARTS_DARK.spectrum,
    strokeLive: "#1d4ed8",
    strokeSnap: "#c2410c",
  },
};

/** Third dark theme: same semantic shell as `audiometer-dark`, warmer chart accents. */
const CHARTS_EMBER = {
  loudnessHistory: {
    ...CHARTS_DARK.loudnessHistory,
    momentaryStroke: "#fb7185",
    momentaryStrokeSnap: "#fdba74",
    shortTermStroke: "#f43f5e",
    shortTermStrokeSnap: "#fb923c",
    selectionStroke: "#fb923c",
  },
  vectorscope: {
    ...CHARTS_DARK.vectorscope,
    strokeLive: "#f43f5e",
    strokeSnap: "#fdba74",
  },
  spectrum: {
    ...CHARTS_DARK.spectrum,
    strokeLive: "#f43f5e",
    strokeSnap: "#fdba74",
  },
};

const METER_GRADIENT = {
  top: "#f97373",
  mid: "#fbbf3b",
  midStopPercent: 46,
  bottom: "#34d399",
};

const METER_GRADIENT_EMBER = {
  top: "#fb923c",
  mid: "#fbbf24",
  midStopPercent: 46,
  bottom: "#4ade80",
};

/** @type {Record<ThemeId, BuiltinTheme>} */
export const BUILTIN_THEMES = {
  "audiometer-dark": {
    id: "audiometer-dark",
    label: "Dark",
    semantic: AUDIOMETER_SEMANTIC_DARK,
    charts: CHARTS_DARK,
    meterGradient: METER_GRADIENT,
    colorScheme: "dark",
  },
  "audiometer-light": {
    id: "audiometer-light",
    label: "Light",
    semantic: AUDIOMETER_SEMANTIC_LIGHT,
    charts: CHARTS_LIGHT,
    meterGradient: METER_GRADIENT,
    colorScheme: "light",
  },
  "audiometer-ember": {
    id: "audiometer-ember",
    label: "Ember (dark)",
    semantic: AUDIOMETER_SEMANTIC_DARK,
    charts: CHARTS_EMBER,
    meterGradient: METER_GRADIENT_EMBER,
    colorScheme: "dark",
  },
};

/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(
  /** @type {ThemeId[]} */ (["audiometer-dark", "audiometer-light", "audiometer-ember"])
);

/**
 * @param {unknown} id
 * @returns {id is ThemeId}
 */
export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(/** @type {ThemeId} */ (id));
}

/** Settings and pickers: stable order + human label per ADR 0002 §13. */
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
