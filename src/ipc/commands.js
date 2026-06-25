/**
 * All `invoke` calls for the Rust backend. UI code must import from here, not `@tauri-apps/api` directly.
 */
import { Channel, invoke } from "@tauri-apps/api/core";

export async function listAudioDevices() {
  return invoke("list_audio_devices");
}

/** @param {string} deviceId Pass `"default"` for the OS default playback device (WASAPI loopback). */
export async function previewAudioDevice(deviceId) {
  return invoke("preview_audio_device", { deviceId });
}

/** @returns {Promise<string | null | undefined>} Current v2 id, or nothing if unknown/unplugged. */
export function migrateCaptureDeviceId(deviceId) {
  return invoke("migrate_capture_device_id", { deviceId });
}

/** @param {{ deviceId: string; onFrame: (payload: object) => void }} opts */
export async function startAudioCapture({ deviceId, onFrame }) {
  const onAudio = new Channel();
  onAudio.onmessage = (msg) => {
    const p = msg && typeof msg === "object" && "message" in msg ? msg.message : msg;
    if (p && typeof p === "object") onFrame(p);
  };
  await invoke("audio_start", { deviceId, onFrame: onAudio });
  return onAudio;
}

export function stopAudioCapture() {
  return invoke("audio_stop");
}

/**
 * Heartbeat ack: tells the native engine the highest frame `seq` the UI has processed, so the
 * capture bridge can bound how far ahead it sends and drop frames if the UI stalls. Fire-and-forget.
 * @param {number} seq
 */
export function ackFrames(seq) {
  return invoke("ack_frames", { seq });
}

/** Clears native loudness history ring and peak maxima (call with UI Clear when Tauri capture is running). */
export function clearAudioHistory() {
  return invoke("clear_audio_history");
}

/** @returns {Promise<"running" | "stopped">} */
export function getEngineState() {
  return invoke("get_engine_state");
}

export function currentWindowBounds() {
  return invoke("current_window_bounds");
}

export function applyWindowBounds(bounds) {
  return invoke("apply_window_bounds", { bounds });
}

/**
 * @param {{ spectrum: Array<{ key: string; channel: object; view: string; smoothingPercent: number; tiltDbPerOctave: number }>; vectorscope: Array<{ key: string; x: number; y: number }> }} requests
 */
export function setAnalysisRequests(requests) {
  return invoke("set_analysis_requests", { requests });
}

/** @param {number[] | null} weights */
export function setLoudnessWeights(weights) {
  return invoke("set_loudness_weights", { weights });
}

export function setDialogueGating(enabled) {
  return invoke("set_dialogue_gating", { enabled: !!enabled });
}

/** @param {string} path Local media path selected or dropped in the desktop app. */
export function probeFileAnalysis(path) {
  return invoke("file_analysis_probe", { path });
}

/** @param {{ path: string; onFrame: (payload: object) => void }} opts */
export async function startFileAnalysis({ path, onFrame }) {
  const onAudio = new Channel();
  onAudio.onmessage = (msg) => {
    const p = msg && typeof msg === "object" && "message" in msg ? msg.message : msg;
    if (p && typeof p === "object") onFrame(p);
  };
  await invoke("file_analysis_start", { path, onFrame: onAudio });
  return onAudio;
}

export function stopFileAnalysis() {
  return invoke("file_analysis_stop");
}
