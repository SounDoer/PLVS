import { UI_PREFERENCES } from "./data.js";

/** Default stereo/surround L/R pair for vectorscope (first two channels in layout order). */
export function readPersistedVectorscopePair(prefs) {
  const p = prefs ?? UI_PREFERENCES;
  try {
    const raw = localStorage.getItem(p.layoutPersistKey);
    if (!raw) return { x: 0, y: 1 };
    const s = JSON.parse(raw);
    if (typeof s.vectorscopePairX === "number" && typeof s.vectorscopePairY === "number") {
      return { x: s.vectorscopePairX, y: s.vectorscopePairY };
    }
  } catch (_) {}
  return { x: 0, y: 1 };
}

export function readPersistedUiMode(prefs) {
  const p = prefs ?? UI_PREFERENCES;
  try {
    const raw = localStorage.getItem(p.layoutPersistKey);
    if (!raw) return "system";
    const s = JSON.parse(raw);
    if (s.uiMode === "system" || s.uiMode === "light" || s.uiMode === "dark") return s.uiMode;
  } catch (_) {}
  return "system";
}

/**
 * @returns {boolean} Whether the OS / browser reports dark as the preferred color scheme.
 * Defaults to `true` when `matchMedia` is unavailable (matches the former app default look).
 */
export function readSystemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * @param {"system" | "dark" | "light"} stored
 * @param {boolean} systemPrefersDark
 * @returns {"dark" | "light"}
 */
export function resolveEffectiveUiMode(stored, systemPrefersDark) {
  if (stored === "light") return "light";
  if (stored === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}
