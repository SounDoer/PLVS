import { DEFAULT_CLEAR_SHORTCUT } from "../lib/clearShortcutPrefs.js";
import { sanitizeChannelLabelOverrides } from "../math/channelRoles.js";
import {
  normalizePanelOpacity,
  normalizeReferenceLufs,
  normalizeSettingsFocusView,
  normalizeThemeEditorPos,
} from "../settings/defaults.js";
import { normalizeCustomTheme } from "../theme/customTheme.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

export const PROFILE_APP = "PLVS";
export const PROFILE_KIND = "configuration-profile";
export const PROFILE_VERSION = 1;
export const PROFILE_EXTENSION = "plvsconfig";

export class ProfileValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function clonePlainObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function normalizeCaptureDeviceId(value) {
  if (value === "default") return "default";
  return typeof value === "string" && /^(in|out):\d+$/.test(value) ? value : "default";
}

function normalizeWindowBounds(value) {
  if (!isPlainObject(value)) return null;
  const { x, y, width, height, isMaximized } = value;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    isMaximized: isMaximized === true,
  };
}

function normalizeSettings(settings) {
  const next = clonePlainObject(settings);
  if ("referenceLufs" in next) next.referenceLufs = normalizeReferenceLufs(next.referenceLufs);
  if ("focusView" in next) next.focusView = normalizeSettingsFocusView(next.focusView);
  if ("panelOpacity" in next) next.panelOpacity = normalizePanelOpacity(next.panelOpacity);
  if ("themeEditorPos" in next) next.themeEditorPos = normalizeThemeEditorPos(next.themeEditorPos);
  if ("channelLabelOverrides" in next) {
    next.channelLabelOverrides = sanitizeChannelLabelOverrides(next.channelLabelOverrides);
  }
  if ("appearance" in next && next.appearance !== "fixed" && next.appearance !== "system") {
    delete next.appearance;
  }
  if ("themeId" in next && next.themeId != null && typeof next.themeId !== "string") {
    delete next.themeId;
  }
  return next;
}

function normalizePresets(presets) {
  if (!isPlainObject(presets)) return { list: [], activeId: null };
  const list = (Array.isArray(presets.list) ? presets.list : []).filter(
    (preset) =>
      isPlainObject(preset) &&
      typeof preset.id === "string" &&
      typeof preset.name === "string" &&
      hasKnownModulesOnly(preset)
  );
  const activeId =
    typeof presets.activeId === "string" && list.some((preset) => preset.id === presets.activeId)
      ? presets.activeId
      : null;
  return { list, activeId };
}

function normalizeThemes(raw) {
  if (!isPlainObject(raw)) return { themes: {}, order: [] };
  const rawThemes = isPlainObject(raw.themes) ? raw.themes : {};
  const themes = {};
  for (const [id, theme] of Object.entries(rawThemes)) {
    const normalized = normalizeCustomTheme(theme);
    if (normalized) themes[id] = normalized;
  }
  const order = (Array.isArray(raw.order) ? raw.order : []).filter(
    (id) => typeof id === "string" && themes[id]
  );
  for (const id of Object.keys(themes)) {
    if (!order.includes(id)) order.push(id);
  }
  return { themes, order };
}

function normalizeClearShortcut(value) {
  return typeof value === "string" && value.trim() ? value : DEFAULT_CLEAR_SHORTCUT;
}

export function buildProfileSnapshot(raw = {}, { exportedAt = new Date().toISOString() } = {}) {
  return {
    app: PROFILE_APP,
    kind: PROFILE_KIND,
    version: PROFILE_VERSION,
    exportedAt,
    settings: normalizeSettings(raw.settings),
    workspace: clonePlainObject(raw.workspace),
    presets: normalizePresets(raw.presets),
    themes: normalizeThemes(raw.themes),
    windowBounds: normalizeWindowBounds(raw.windowBounds),
    captureDeviceId: normalizeCaptureDeviceId(raw.captureDeviceId),
    clearShortcut: normalizeClearShortcut(raw.clearShortcut),
    clearGlobal: raw.clearGlobal === true,
  };
}

export function normalizeImportedProfile(raw) {
  if (!isPlainObject(raw)) {
    throw new ProfileValidationError("Choose a PLVS configuration file.");
  }
  if (raw.app !== PROFILE_APP || raw.kind !== PROFILE_KIND) {
    throw new ProfileValidationError("This is not a PLVS configuration file.");
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new ProfileValidationError("This PLVS configuration file is missing a version.");
  }
  if (raw.version > PROFILE_VERSION) {
    throw new ProfileValidationError("This PLVS configuration file was made by a newer version.");
  }
  const opts = typeof raw.exportedAt === "string" ? { exportedAt: raw.exportedAt } : undefined;
  return buildProfileSnapshot(raw, opts);
}
