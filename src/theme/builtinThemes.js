/**
 * Builtin colour themes.
 * @typedef {"plvs-dark" | "plvs-light"} ThemeId
 */

import { PLVS_SEMANTIC_DARK, PLVS_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";
import { INFERNO_COLORMAP_STOPS } from "./spectrogramColormap.js";

/** @typedef {import("./shadcnSemanticPreset.js").ShadcnSemantic} ShadcnSemantic */

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
 *   colorScheme: "light" | "dark";
 *   seeds: ThemeSeeds;
 *   colormap: import("./spectrogramColormap.js").SpectrogramColorStops;
 * }} BuiltinTheme
 */

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("plvs-dark");

/** @type {Record<ThemeId, BuiltinTheme>} */
export const BUILTIN_THEMES = {
  "plvs-dark": {
    id: "plvs-dark",
    label: "Dark",
    semantic: PLVS_SEMANTIC_DARK,
    colorScheme: "dark",
    seeds: {
      accent: "#fb923c",
      accentSecondary: "#38bdf8",
      signal: { good: "#34d399", warn: "#fbbf24", bad: "#f97373" },
    },
    colormap: INFERNO_COLORMAP_STOPS,
  },
  "plvs-light": {
    id: "plvs-light",
    label: "Light",
    semantic: PLVS_SEMANTIC_LIGHT,
    colorScheme: "light",
    seeds: {
      accent: "#e07020",
      accentSecondary: "#0e7490",
      signal: { good: "#18976a", warn: "#fbbf24", bad: "#d03535" },
    },
    colormap: INFERNO_COLORMAP_STOPS,
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
