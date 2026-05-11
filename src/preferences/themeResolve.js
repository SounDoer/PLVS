/**
 * Resolves persisted shell appearance + optional fixed theme id to a concrete builtin theme id.
 * @see docs/adr/0002-theme-id-and-appearance.md
 */

import { DEFAULT_THEME_ID, isThemeId, THEME_IDS } from "../theme/builtinThemes.js";

export { DEFAULT_THEME_ID, isThemeId, THEME_IDS };

/**
 * @param {unknown} raw
 * @returns {{ appearance: "system"|"fixed"; themeId: string|null }}
 */
export function parsePersistedUiStateJson(raw) {
  if (raw == null || raw === "") {
    return { appearance: "system", themeId: null };
  }
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!s || typeof s !== "object") {
      return { appearance: "system", themeId: null };
    }
    if (s.appearance === "fixed" || s.appearance === "system") {
      const themeId = s.themeId == null || s.themeId === "" ? null : String(s.themeId);
      return {
        appearance: s.appearance,
        themeId: s.appearance === "system" ? null : themeId,
      };
    }
    return { appearance: "system", themeId: null };
  } catch {
    return { appearance: "system", themeId: null };
  }
}

/**
 * Reads and parses the persisted UI JSON blob for theme fields.
 * @param {{ layoutPersistKey?: string }} [prefs]
 * @returns {{ appearance: "system"|"fixed"; themeId: string|null }}
 */
export function readPersistedShellThemeFields(prefs) {
  if (typeof localStorage === "undefined") {
    return { appearance: "system", themeId: null };
  }
  const key = prefs?.layoutPersistKey ?? "audiometer.ui";
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { appearance: "system", themeId: null };
    return parsePersistedUiStateJson(raw);
  } catch {
    return { appearance: "system", themeId: null };
  }
}

/**
 * @param {{ appearance?: unknown; themeId?: unknown }} shell
 * @param {boolean} systemPrefersDark
 * @returns {import("../theme/builtinThemes.js").ThemeId}
 */
export function resolveThemeId(shell, systemPrefersDark) {
  const appearance = shell?.appearance === "fixed" ? "fixed" : "system";
  if (appearance === "system") {
    return systemPrefersDark ? DEFAULT_THEME_ID : "audiometer-light";
  }
  const rawId = shell?.themeId;
  const id = rawId == null || rawId === "" ? null : String(rawId);
  if (!isThemeId(id)) {
    if (import.meta.env.DEV && id != null && id !== "") {
      console.warn(`[AudioMeter] Unknown themeId "${id}"; falling back to ${DEFAULT_THEME_ID}.`);
    }
    return DEFAULT_THEME_ID;
  }
  return id;
}
