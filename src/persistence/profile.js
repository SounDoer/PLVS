import { isTauri } from "../ipc/env.js";
import {
  exportProfileCommand,
  importProfileCommand,
  resetProfileCommand,
} from "../ipc/commands.js";
import { LEGACY_CAPTURE_DEVICE_LS_KEY } from "../ipc/capturePrefs.js";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../data/keyboardShortcutActions.js";
import {
  exportAll,
  flushPersistence,
  presetsStore,
  resetAll,
  settingsStore,
  themesStore,
  workspaceStore,
} from "./index.js";
import { suspendPluginStorePersistence } from "./pluginStoreBackend.js";
import { buildProfileSnapshot, normalizeImportedProfile } from "./profileShape.js";
import { closeTrayIcon } from "../lib/trayIconLifecycle.js";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  abortGlobalOperation,
  commitGlobalOperation,
  prepareGlobalOperation,
} from "../runtime/coordination.js";

let pendingProfileRestart = null;
let savingProfile = false;
let restartingProfile = null;
const restartListeners = new Set();

export function configurationRestartPending() {
  return pendingProfileRestart !== null;
}

export function subscribeConfigurationRestart(listener) {
  restartListeners.add(listener);
  return () => restartListeners.delete(listener);
}

function setPendingProfileRestart(pending) {
  pendingProfileRestart = pending;
  for (const listener of restartListeners) listener();
}

async function saveDesktopProfile(save) {
  if (savingProfile || configurationRestartPending()) {
    throw new Error("Finish the current configuration change before starting another.");
  }
  savingProfile = true;
  try {
    const operation = await prepareGlobalOperation();
    try {
      await save();
    } catch (error) {
      await abortGlobalOperation(operation);
      throw error;
    }
    suspendPluginStorePersistence();
    setPendingProfileRestart({ operation, peersClosed: false });
  } finally {
    savingProfile = false;
  }
}

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
    keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  };
}

function replaceStore(store, value) {
  store.reset();
  store.patch(value);
}

export async function exportProfile() {
  await flushPersistence();
  const raw = isTauri() ? await exportProfileCommand() : browserRawProfile();
  return buildProfileSnapshot(raw);
}

export async function importProfile(raw) {
  const profile = normalizeImportedProfile(raw);
  if (isTauri()) {
    await saveDesktopProfile(() => importProfileCommand(profile));
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
    await saveDesktopProfile(resetProfileCommand);
    return;
  }
  resetAll();
  try {
    localStorage.removeItem(LEGACY_CAPTURE_DEVICE_LS_KEY);
  } catch (_) {}
}

async function restartDesktopAfterProfileChange() {
  const pending = pendingProfileRestart;
  if (pending && !pending.peersClosed) {
    const operation = pending.operation ?? (await prepareGlobalOperation());
    try {
      await commitGlobalOperation(operation);
      pending.peersClosed = true;
    } catch (error) {
      pending.operation = null;
      await abortGlobalOperation(operation);
      throw error;
    }
  }
  await closeTrayIcon();
  await relaunch();
  setPendingProfileRestart(null);
}

export async function reloadAfterProfileChange() {
  if (isTauri()) {
    restartingProfile ??= restartDesktopAfterProfileChange().finally(() => {
      restartingProfile = null;
    });
    return restartingProfile;
  }
  window.location.reload();
}
