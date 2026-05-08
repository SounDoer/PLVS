/**
 * Tauri `listen` helpers (slow loudness, device list).
 */
import { listen } from "@tauri-apps/api/event";

/**
 * @param {(payload: import("./types.js").LoudnessSlowPayload) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onLoudnessSlow(handler) {
  return listen("loudness-slow", (e) => {
    handler(e.payload);
  });
}

/**
 * @param {(devices: { id: string; label: string }[]) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onDeviceListChanged(handler) {
  return listen("device-list-changed", (e) => {
    handler(e.payload);
  });
}

/**
 * @param {(payload: import("./types.js").EngineStateChangedPayload) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onEngineStateChanged(handler) {
  return listen("engine-state-changed", (e) => {
    handler(e.payload);
  });
}

/**
 * @param {(payload: import("./types.js").EngineBackpressurePayload) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onEngineBackpressure(handler) {
  return listen("engine-backpressure", (e) => {
    handler(e.payload);
  });
}

/**
 * @param {(sampleRateHz: number) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onSampleRateChanged(handler) {
  return listen("sample-rate-changed", (e) => {
    handler(e.payload);
  });
}

/**
 * After `clear_audio_history`: native ring and buffer are cleared; float webviews should reset
 * in-memory ref rings to match the main window.
 * @param {() => void} handler
 * @returns {Promise<() => void>}
 */
export async function onMeterHistoryCleared(handler) {
  return listen("meter-history-cleared", () => {
    handler();
  });
}
