import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./builtinThemes.js";

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 */
export function isKnownThemeId(id, customThemes = {}) {
  if (typeof id !== "string") return false;
  return id in BUILTIN_THEMES || id in customThemes;
}

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 * @returns {object} a builtin or custom theme; falls back to plvs-dark
 */
export function getTheme(id, customThemes = {}) {
  if (typeof id === "string") {
    if (id in BUILTIN_THEMES) return BUILTIN_THEMES[id];
    if (id in customThemes) return customThemes[id];
  }
  return BUILTIN_THEMES[DEFAULT_THEME_ID];
}
