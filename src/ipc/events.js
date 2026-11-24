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
 * Audio dropped before analysis during Live capture (low frequency, only when drops occurred).
 * @param {(payload: { droppedChunks: number }) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onEngineBackpressure(handler) {
  return listen("engine-backpressure", (e) => {
    handler(e.payload);
  });
}

/** @param {(payload: { unavailable: string[], partialAt: number | null }) => void} handler */
export function onMixCaptureStatus(handler) {
  return listen("mix-capture-status", (event) => handler(event.payload));
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
 * The bounds Rust just persisted for the normal window.
 * @param {(bounds: { x: number, y: number, width: number, height: number, isMaximized: boolean }) => void} handler
 * @returns {Promise<() => void>}
 */
export async function onWindowBoundsChanged(handler) {
  return listen("window-bounds-changed", (e) => {
    handler(/** @type {any} */ (e.payload));
  });
}

/** @param {() => void} handler */
export function onWindowDisplaysChanged(handler) {
  return listen("window-displays-changed", handler);
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

/**
 * The user clicked or switched to another application while the Dock strip refuses activation over
 * a full-screen window, or the macOS Dock leaves the active Space.
 * @param {() => void} handler
 * @returns {Promise<() => void>}
 */
export async function onDockInteractionElsewhere(handler) {
  return listen("dock-interaction-elsewhere", () => handler());
}

/** @param {() => void} handler @returns {Promise<() => void>} */
export async function onDockNativeGeometryChanged(handler) {
  return listen("dock-native-geometry-changed", () => handler());
}
