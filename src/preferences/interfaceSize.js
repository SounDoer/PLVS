import { settingsStore } from "../persistence/index.js";
import { isDockAccessorySurface } from "../dock/accessoryProtocol.js";
import {
  DEFAULT_INTERFACE_SIZE,
  INTERFACE_SIZE_OPTIONS,
  normalizeInterfaceSize,
} from "../settings/defaults.js";
import { UI_PREFERENCES } from "./data.js";

export { DEFAULT_INTERFACE_SIZE, INTERFACE_SIZE_OPTIONS, normalizeInterfaceSize };

const PROFILES = Object.freeze({
  default: {
    controlHeightPx: 24,
    drawerWidthPx: 336,
    editorWidthPx: 416,
    surfaces: { compactWidthPx: 320, dialogWidthPx: 448, wideWidthPx: 544, statusWidthPx: 384 },
    typography: {
      caption: 11,
      axis: 12,
      status: 12,
      control: 13,
      metricMeta: 13,
      panelTitle: 13,
      display: 14,
      body: 15,
      metricValue: 18,
    },
    iconography: {
      panelAction: 13,
      managementAction: 15,
      shellAction: 15,
      panelModule: 15,
    },
  },
  large: {
    controlHeightPx: 28,
    drawerWidthPx: 368,
    editorWidthPx: 448,
    surfaces: { compactWidthPx: 368, dialogWidthPx: 512, wideWidthPx: 608, statusWidthPx: 432 },
    typography: {
      caption: 12,
      axis: 14,
      status: 14,
      control: 15,
      metricMeta: 15,
      panelTitle: 15,
      display: 16,
      body: 17,
      metricValue: 21,
    },
    iconography: {
      panelAction: 15,
      managementAction: 17,
      shellAction: 17,
      panelModule: 17,
    },
  },
  "extra-large": {
    controlHeightPx: 32,
    drawerWidthPx: 400,
    editorWidthPx: 480,
    surfaces: { compactWidthPx: 416, dialogWidthPx: 576, wideWidthPx: 672, statusWidthPx: 480 },
    typography: {
      caption: 14,
      axis: 16,
      status: 16,
      control: 17,
      metricMeta: 17,
      panelTitle: 17,
      display: 18,
      body: 19,
      metricValue: 24,
    },
    iconography: {
      panelAction: 17,
      managementAction: 19,
      shellAction: 19,
      panelModule: 19,
    },
  },
});

export function readPersistedInterfaceSize() {
  return normalizeInterfaceSize(settingsStore.read().interfaceSize);
}

/**
 * @param {string} rawSize
 */
export function resolveInterfacePreferences(prefs = UI_PREFERENCES, rawSize) {
  const size = normalizeInterfaceSize(rawSize);
  if (size === "small") return prefs;
  const profile = PROFILES[size];
  return {
    ...prefs,
    layout: {
      ...prefs.layout,
      surfaces: profile.surfaces,
      control: {
        ...prefs.layout.control,
        heightPx: profile.controlHeightPx,
      },
      editor: {
        ...prefs.layout.editor,
        preferredWidthPx: profile.editorWidthPx,
      },
      drawer: {
        ...prefs.layout.drawer,
        preferredWidthPx: profile.drawerWidthPx,
      },
    },
    typography: {
      ...prefs.typography,
      sizesPx: { ...profile.typography },
    },
    iconography: {
      ...prefs.iconography,
      sizesPx: { ...profile.iconography },
    },
  };
}

/**
 * @param {string} rawSize
 * @param {string} surface
 */
export function resolveInterfacePreferencesForSurface(prefs, rawSize, surface) {
  const resolved = resolveInterfacePreferences(prefs, rawSize);
  // Native accessory geometry stays compact; text uses the same roles as the main window.
  return isDockAccessorySurface(surface) && !["dock-settings", "dock-authoring"].includes(surface)
    ? {
        ...prefs,
        layout: { ...prefs.layout, surfaces: resolved.layout.surfaces },
        typography: resolved.typography,
      }
    : resolved;
}

/** Shared CSS-pixel widths for both the web surfaces and their native Dock hosts. */
export function resolveSurfaceWidths(rawSize) {
  return resolveInterfacePreferences(UI_PREFERENCES, rawSize).layout.surfaces;
}
