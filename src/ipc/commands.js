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

/** Clears native loudness history ring and peak maxima (call with UI Clear when Tauri capture is running). */
export function clearAudioHistory() {
  return invoke("clear_audio_history");
}

/** @returns {Promise<import("./types.js").MeterHistoryEntry[]>} */
export function getMeterHistory() {
  return invoke("get_meter_history");
}

/** @returns {Promise<"running" | "stopped">} */
export function getEngineState() {
  return invoke("get_engine_state");
}

/**
 * @param {string} id
 * @param {{ onFrame: (payload: object) => void }} opts
 */
export async function meterAddFrameSubscriber(id, { onFrame }) {
  const ch = new Channel();
  ch.onmessage = (msg) => {
    const p = msg && typeof msg === "object" && "message" in msg ? msg.message : msg;
    if (p && typeof p === "object") onFrame(p);
  };
  await invoke("meter_add_frame_subscriber", { id, onFrame: ch });
  return ch;
}

/** @param {string} id */
export function meterRemoveFrameSubscriber(id) {
  return invoke("meter_remove_frame_subscriber", { id });
}

/** @param {{ x: number; y: number }} pair 0-based channel indices. */
export function setVectorscopePair({ x, y }) {
  return invoke("set_vectorscope_pair", { x, y });
}

/** @param {{ layout: "auto" | "stereo" | "5.1" | string }} opts */
export function setChannelLayout({ layout }) {
  return invoke("set_channel_layout", { layout });
}
