import { DEFAULT_THEME_ID } from "./builtinThemes.js";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 */
export function isKnownThemeId(id, customThemes = {}) {
  if (typeof id !== "string") return false;
  return id in BUILTIN_THEMES_V2 || id in customThemes;
}

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 * @returns {object} a builtin or custom theme; falls back to plvs-dark
 */
export function getTheme(id, customThemes = {}) {
  if (typeof id === "string") {
    if (id in BUILTIN_THEMES_V2) return BUILTIN_THEMES_V2[id];
    if (id in customThemes) return customThemes[id];
  }
  return BUILTIN_THEMES_V2[DEFAULT_THEME_ID];
}
