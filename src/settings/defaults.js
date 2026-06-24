import { DEFAULT_REFERENCE_LUFS as LOUDNESS_DEFAULT_REFERENCE_LUFS } from "../config/loudnessReferenceProfiles.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";

export const DEFAULT_REFERENCE_LUFS = LOUDNESS_DEFAULT_REFERENCE_LUFS;
export const DEFAULT_CLOSE_ACTION = "ask";
export const DEFAULT_THEME_EDITOR_POS = Object.freeze({ x: 80, y: 80 });

export function normalizeReferenceLufs(raw) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return DEFAULT_REFERENCE_LUFS;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : DEFAULT_REFERENCE_LUFS;
}

export function normalizeCloseAction(raw) {
  return raw === "tray" || raw === "quit" || raw === "ask" ? raw : DEFAULT_CLOSE_ACTION;
}

export function normalizeSettingsFocusView(raw) {
  return normalizeFocusView(raw ?? DEFAULT_FOCUS_VIEW);
}

export function normalizeThemeEditorPos(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_THEME_EDITOR_POS;
  const { x, y } = raw;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : DEFAULT_THEME_EDITOR_POS;
}
