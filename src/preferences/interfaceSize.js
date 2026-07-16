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
    drawerWidthPx: 336,
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
    drawerWidthPx: 368,
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
    drawerWidthPx: 400,
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

export function resolveInterfacePreferences(prefs = UI_PREFERENCES, rawSize) {
  const size = normalizeInterfaceSize(rawSize);
  if (size === "small") return prefs;
  const profile = PROFILES[size];
  return {
    ...prefs,
    layout: {
      ...prefs.layout,
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

export function resolveInterfacePreferencesForSurface(prefs, rawSize, surface) {
  return resolveInterfacePreferences(prefs, isDockAccessorySurface(surface) ? "small" : rawSize);
}
