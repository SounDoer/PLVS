import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  normalizeKeyboardShortcuts,
} from "../data/keyboardShortcutActions.js";
import { isTauri } from "../ipc/env.js";

// The one store file, shared with the other persisted domains. Its historical name is intentional.
const STORE_FILE = "plvs-settings.json";
const SHORTCUTS_KEY = "keyboardShortcuts";

function transactionalBoot() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
}

function fromPreferences(preferences = {}) {
  return normalizeKeyboardShortcuts(preferences[SHORTCUTS_KEY], {
    clearShortcut: preferences.clearShortcut,
    clearGlobal: preferences.clearGlobal,
  });
}

export async function loadKeyboardShortcutPrefs() {
  if (!isTauri()) return normalizeKeyboardShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
  if (transactionalBoot()) {
    return fromPreferences(window.__PLVS_INITIAL_STATE__?.globalPreferences);
  }
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    return fromPreferences({
      [SHORTCUTS_KEY]: await store.get(SHORTCUTS_KEY),
      clearShortcut: await store.get("clearShortcut"),
      clearGlobal: await store.get("clearGlobal"),
    });
  } catch (_) {
    return normalizeKeyboardShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
  }
}

export async function saveKeyboardShortcutPrefs(shortcuts) {
  if (!isTauri()) return;
  try {
    await saveKeyboardShortcutPrefsForControl(shortcuts);
  } catch (_) {}
}

export async function saveKeyboardShortcutPrefsForControl(shortcuts) {
  if (!isTauri()) return;
  const normalized = normalizeKeyboardShortcuts(shortcuts);
  if (transactionalBoot()) {
    const metadata = window.__PLVS_INITIAL_STATE__.multiInstancePersistence;
    const { invoke } = await import("@tauri-apps/api/core");
    const revisions = await invoke("persistence_save_global_preferences", {
      values: { [SHORTCUTS_KEY]: normalized },
      expectedRevisions: {
        [SHORTCUTS_KEY]: metadata.globalPreferenceRevisions?.[SHORTCUTS_KEY] ?? 0,
      },
    });
    window.__PLVS_INITIAL_STATE__.globalPreferences = {
      ...(window.__PLVS_INITIAL_STATE__.globalPreferences || {}),
      [SHORTCUTS_KEY]: normalized,
    };
    metadata.globalPreferenceRevisions = {
      ...(metadata.globalPreferenceRevisions || {}),
      ...revisions,
    };
    return;
  }
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load(STORE_FILE);
  await store.set(SHORTCUTS_KEY, normalized);
  await store.save();
}
