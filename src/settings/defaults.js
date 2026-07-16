import { DEFAULT_REFERENCE_LUFS as LOUDNESS_DEFAULT_REFERENCE_LUFS } from "../config/loudnessReferenceProfiles.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";

export const DEFAULT_REFERENCE_LUFS = LOUDNESS_DEFAULT_REFERENCE_LUFS;
export const DEFAULT_CLOSE_ACTION = "ask";
export const DEFAULT_PANEL_OPACITY = 100;
export const DEFAULT_GLASS_ENABLED = false;
export const DEFAULT_HISTORY_RETENTION_SEC = 3600;
export const HISTORY_RETENTION_OPTIONS_SEC = [1800, 3600, 7200, 14400];
export const DEFAULT_THEME_EDITOR_POS = Object.freeze({ x: 80, y: 80 });
export const DEFAULT_INTERFACE_SIZE = "default";
export const INTERFACE_SIZE_OPTIONS = Object.freeze([
  { id: "small", label: "Small" },
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
  { id: "extra-large", label: "Extra Large" },
]);

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

export function normalizePanelOpacity(raw) {
  if (raw == null) return DEFAULT_PANEL_OPACITY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PANEL_OPACITY;
  return Math.round(Math.max(0, Math.min(100, n)));
}

export function normalizeGlassEnabled(raw) {
  return raw === true;
}

export function normalizeHistoryRetentionSec(raw) {
  return HISTORY_RETENTION_OPTIONS_SEC.includes(raw) ? raw : DEFAULT_HISTORY_RETENTION_SEC;
}

export function normalizeInterfaceSize(raw) {
  return INTERFACE_SIZE_OPTIONS.some(({ id }) => id === raw) ? raw : DEFAULT_INTERFACE_SIZE;
}
