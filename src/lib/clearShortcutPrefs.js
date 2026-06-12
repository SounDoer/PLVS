import { isTauri } from "../ipc/env.js";

const STORE_FILE = "plvs-settings.json";
const SHORTCUT_KEY = "clearShortcut";
const GLOBAL_KEY = "clearGlobal";

export const DEFAULT_CLEAR_SHORTCUT = "CmdOrCtrl+K";

export async function loadClearShortcutPrefs() {
  const fallback = { shortcut: DEFAULT_CLEAR_SHORTCUT, global: false };
  if (!isTauri()) return fallback;
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
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    await store.set(SHORTCUT_KEY, String(shortcut));
    await store.set(GLOBAL_KEY, Boolean(global));
    await store.save();
  } catch (_) {}
}
