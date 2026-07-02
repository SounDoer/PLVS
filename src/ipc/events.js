/**
 * Tauri `listen` helpers.
 */
import { listen } from "@tauri-apps/api/event";

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
 * @param {(sampleRateHz: number) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onSampleRateChanged(handler) {
  return listen("sample-rate-changed", (e) => {
    handler(e.payload);
  });
}

/** @param {() => void} handler @returns {Promise<() => void>} */
export async function onMeterHistoryCleared(handler) {
  return listen("meter-history-cleared", () => {
    handler();
  });
}

/** @param {() => void} handler @returns {Promise<() => void>} */
export async function onWindowBoundsChanged(handler) {
  return listen("window-bounds-changed", () => {
    handler();
  });
}

function unwrapEventPayload(event) {
  return event?.payload ?? event;
}

export function onFileAnalysisProgress(handler) {
  return listen("file-analysis-progress", (event) => handler(unwrapEventPayload(event)));
}

export function onFileAnalysisCompleted(handler) {
  return listen("file-analysis-completed", (event) => handler(unwrapEventPayload(event)));
}

export function onFileAnalysisError(handler) {
  return listen("file-analysis-error", (event) => handler(unwrapEventPayload(event)));
}
