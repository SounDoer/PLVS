/**
 * Persist last capture device id: Tauri uses `tauri-plugin-store` (app data dir);
 * browser / dev uses localStorage only.
 */
import { isTauri } from "./env.js";

const STORE_FILE = "plvs-settings.json";
const STORE_KEY = "captureDeviceId";

/** Legacy key (pre–plugin-store); still read once for migration. */
export const LEGACY_CAPTURE_DEVICE_LS_KEY = "plvs.captureDeviceId";

function validateId(raw) {
  if (raw === "default") return "default";
  if (typeof raw === "string" && /^(in|out):\d+$/.test(raw)) return raw;
  return "default";
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
 * Preferred device id after optional async load from Store (Tauri).
 * @returns {Promise<string>}
 */
export async function loadCaptureDeviceId() {
  if (!isTauri()) {
    return readCaptureDeviceIdFromLocalStorage();
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
  try {
    localStorage.setItem(LEGACY_CAPTURE_DEVICE_LS_KEY, v);
  } catch (_) {}
  if (!isTauri()) return;
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load(STORE_FILE);
  await store.set(STORE_KEY, v);
  await store.save();
}
