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
  large: {
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
  "extra-large": {
    typography: {
      caption: 12,
      axis: 13,
      status: 13,
      control: 14,
      metricMeta: 14,
      panelTitle: 14,
      display: 15,
      body: 17,
      metricValue: 19,
    },
    iconography: {
      panelAction: 14,
      managementAction: 17,
      shellAction: 17,
      panelModule: 16,
    },
  },
});

export function readPersistedInterfaceSize() {
  return normalizeInterfaceSize(settingsStore.read().interfaceSize);
}

export function resolveInterfacePreferences(prefs = UI_PREFERENCES, rawSize) {
  const size = normalizeInterfaceSize(rawSize);
  if (size === DEFAULT_INTERFACE_SIZE) return prefs;
  const profile = PROFILES[size];
  return {
    ...prefs,
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
  return resolveInterfacePreferences(
    prefs,
    isDockAccessorySurface(surface) ? DEFAULT_INTERFACE_SIZE : rawSize
  );
}
