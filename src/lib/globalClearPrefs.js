import { isTauri } from "../ipc/env.js";

const STORE_FILE = "plvs-settings.json";
const ENABLED_KEY = "globalClearEnabled";
const SHORTCUT_KEY = "globalClearShortcut";

export const DEFAULT_GLOBAL_CLEAR_SHORTCUT = "CmdOrCtrl+Alt+K";

export async function loadGlobalClearPrefs() {
  const fallback = { enabled: false, shortcut: DEFAULT_GLOBAL_CLEAR_SHORTCUT };
  if (!isTauri()) return fallback;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const enabled = await store.get(ENABLED_KEY);
    const shortcut = await store.get(SHORTCUT_KEY);
    return {
      enabled: typeof enabled === "boolean" ? enabled : false,
      shortcut: typeof shortcut === "string" && shortcut ? shortcut : DEFAULT_GLOBAL_CLEAR_SHORTCUT,
    };
  } catch (_) {
    return fallback;
  }
}

export async function saveGlobalClearPrefs({ enabled, shortcut }) {
  if (!isTauri()) return;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    await store.set(ENABLED_KEY, Boolean(enabled));
    await store.set(SHORTCUT_KEY, String(shortcut));
    await store.save();
  } catch (_) {}
}
