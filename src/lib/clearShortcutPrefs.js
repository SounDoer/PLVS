import { isTauri } from "../ipc/env.js";

// The one store file, same as `pluginStoreBackend.js` -- it holds all four domains, not just
// settings, despite the name.
const STORE_FILE = "plvs-settings.json";
const SHORTCUT_KEY = "clearShortcut";
const GLOBAL_KEY = "clearGlobal";

export const DEFAULT_CLEAR_SHORTCUT = "CmdOrCtrl+K";

function transactionalBoot() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
}

export async function loadClearShortcutPrefs() {
  const fallback = { shortcut: DEFAULT_CLEAR_SHORTCUT, global: false };
  if (!isTauri()) return fallback;
  if (transactionalBoot()) {
    const preferences = window.__PLVS_INITIAL_STATE__?.globalPreferences || {};
    return {
      shortcut:
        typeof preferences.clearShortcut === "string" && preferences.clearShortcut
          ? preferences.clearShortcut
          : DEFAULT_CLEAR_SHORTCUT,
      global: typeof preferences.clearGlobal === "boolean" ? preferences.clearGlobal : false,
    };
  }
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const shortcut = await store.get(SHORTCUT_KEY);
    const global = await store.get(GLOBAL_KEY);
    return {
      shortcut: typeof shortcut === "string" && shortcut ? shortcut : DEFAULT_CLEAR_SHORTCUT,
      global: typeof global === "boolean" ? global : false,
    };
  } catch (_) {
    return fallback;
  }
}

export async function saveClearShortcutPrefs({ shortcut, global }) {
  if (!isTauri()) return;
  try {
    await saveClearShortcutPrefsForControl({ shortcut, global });
  } catch (_) {}
}

export async function saveClearShortcutPrefsForControl({ shortcut, global }) {
  if (!isTauri()) return;
  if (transactionalBoot()) {
    const values = {
      clearShortcut: String(shortcut),
      clearGlobal: Boolean(global),
    };
    const metadata = window.__PLVS_INITIAL_STATE__.multiInstancePersistence;
    const expectedRevisions = {
      clearShortcut: metadata.globalPreferenceRevisions?.clearShortcut ?? 0,
      clearGlobal: metadata.globalPreferenceRevisions?.clearGlobal ?? 0,
    };
    const { invoke } = await import("@tauri-apps/api/core");
    const revisions = await invoke("persistence_save_global_preferences", {
      values,
      expectedRevisions,
    });
    window.__PLVS_INITIAL_STATE__.globalPreferences = {
      ...(window.__PLVS_INITIAL_STATE__.globalPreferences || {}),
      ...values,
    };
    metadata.globalPreferenceRevisions = {
      ...(metadata.globalPreferenceRevisions || {}),
      ...revisions,
    };
    return;
  }
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load(STORE_FILE);
  await store.set(SHORTCUT_KEY, String(shortcut));
  await store.set(GLOBAL_KEY, Boolean(global));
  await store.save();
}
