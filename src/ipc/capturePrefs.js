/**
 * The selected Source belongs to the desktop Workspace and is hydrated by Rust at startup.
 * Older desktop boots fall back to the legacy plugin store. Browser builds use localStorage.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env.js";
import { splitChannelSource } from "../lib/channelSources.js";
import { isSourceMixId } from "../lib/sourceMixes.js";

// Legacy store shared with pluginStoreBackend.js.
const STORE_FILE = "plvs-settings.json";
const STORE_KEY = "captureDeviceId";

/** Legacy key (pre–plugin-store); still read once for migration. */
export const LEGACY_CAPTURE_DEVICE_LS_KEY = "plvs.captureDeviceId";

/**
 * @param {string} raw
 */
function validateId(raw) {
  if (raw === "default") return "default";
  if (isSourceMixId(raw)) return raw;
  if (typeof raw === "string" && splitChannelSource(raw)) return raw;
  if (typeof raw === "string" && /^(lb|cap)-[0-9a-f]{32}$/.test(raw)) return raw;
  if (typeof raw === "string" && /^app-[0-9a-f]{32}$/.test(raw)) return raw;
  if (typeof raw === "string" && /^(in|out):\d+$/.test(raw)) return raw;
  return "default";
}

function transactionalBoot() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
}

/** Synchronous read from localStorage only (first paint / non-Tauri). */
export function readCaptureDeviceIdFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_CAPTURE_DEVICE_LS_KEY);
    return validateId(raw);
  } catch (_) {
    return "default";
  }
}

/**
 * Read the Workspace boot value or load the preference through the fallback backend.
 * @returns {Promise<string>}
 */
export async function loadCaptureDeviceId() {
  if (!isTauri()) {
    return readCaptureDeviceIdFromLocalStorage();
  }
  if (transactionalBoot()) {
    return validateId(window.__PLVS_INITIAL_STATE__?.captureDeviceId);
  }
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load(STORE_FILE);
  const v = await store.get(STORE_KEY);
  if (typeof v === "string" && validateId(v) === v) {
    return v;
  }
  const legacy = readCaptureDeviceIdFromLocalStorage();
  await store.set(STORE_KEY, legacy);
  await store.save();
  return legacy;
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function saveCaptureDeviceId(id) {
  const v = validateId(id);
  if (isTauri() && transactionalBoot()) {
    await invoke("persistence_save_workspace_value", { key: STORE_KEY, value: v });
    window.__PLVS_INITIAL_STATE__.captureDeviceId = v;
    return;
  }
  try {
    localStorage.setItem(LEGACY_CAPTURE_DEVICE_LS_KEY, v);
  } catch (_) {}
  if (!isTauri()) return;
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load(STORE_FILE);
  await store.set(STORE_KEY, v);
  await store.save();
}
