import { isTauri } from "../ipc/env.js";
import {
  exportProfileCommand,
  importProfileCommand,
  resetProfileCommand,
} from "../ipc/commands.js";
import { LEGACY_CAPTURE_DEVICE_LS_KEY } from "../ipc/capturePrefs.js";
import { DEFAULT_CLEAR_SHORTCUT } from "../lib/clearShortcutPrefs.js";
import {
  exportAll,
  presetsStore,
  resetAll,
  settingsStore,
  themesStore,
  workspaceStore,
} from "./index.js";
import {
  flushPluginStorePersistence,
  suspendPluginStorePersistence,
} from "./pluginStoreBackend.js";
import { buildProfileSnapshot, normalizeImportedProfile } from "./profileShape.js";
import { closeTrayIcon } from "../lib/trayIconLifecycle.js";
import { relaunch } from "@tauri-apps/plugin-process";

function browserRawProfile() {
  const domains = exportAll();
  let captureDeviceId = "default";
  try {
    captureDeviceId = localStorage.getItem(LEGACY_CAPTURE_DEVICE_LS_KEY) || "default";
  } catch (_) {}
  return {
    ...domains,
    windowBounds: null,
    captureDeviceId,
    clearShortcut: DEFAULT_CLEAR_SHORTCUT,
    clearGlobal: false,
  };
}

function replaceStore(store, value) {
  store.reset();
  store.patch(value);
}

export async function exportProfile() {
  if (isTauri()) await flushPluginStorePersistence();
  const raw = isTauri() ? await exportProfileCommand() : browserRawProfile();
  return buildProfileSnapshot(raw);
}

export async function importProfile(raw) {
  const profile = normalizeImportedProfile(raw);
  if (isTauri()) {
    suspendPluginStorePersistence();
    await importProfileCommand(profile);
    return profile;
  }

  replaceStore(settingsStore, profile.settings);
  replaceStore(workspaceStore, profile.workspace);
  replaceStore(presetsStore, profile.presets);
  replaceStore(themesStore, profile.themes);
  try {
    localStorage.setItem(LEGACY_CAPTURE_DEVICE_LS_KEY, profile.captureDeviceId);
  } catch (_) {}
  return profile;
}

export async function resetProfile() {
  if (isTauri()) {
    suspendPluginStorePersistence();
    await resetProfileCommand();
    return;
  }
  resetAll();
  try {
    localStorage.removeItem(LEGACY_CAPTURE_DEVICE_LS_KEY);
  } catch (_) {}
}

export async function reloadAfterProfileChange() {
  if (isTauri()) {
    await closeTrayIcon();
    await relaunch();
    return;
  }
  window.location.reload();
}
