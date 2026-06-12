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

/** Clears native loudness history ring and peak maxima (call with UI Clear when Tauri capture is running). */
export function clearAudioHistory() {
  return invoke("clear_audio_history");
}

/** @returns {Promise<"running" | "stopped">} */
export function getEngineState() {
  return invoke("get_engine_state");
}

/** @param {{ x: number; y: number }} pair 0-based channel indices. */
export function setVectorscopePair({ x, y }) {
  return invoke("set_vectorscope_pair", { x, y });
}

/**
 * @param {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} sel
 */
export function setSpectrumChannel(sel) {
  const selType = sel.type;
  const chX = sel.type === "pair" ? sel.x : sel.ch;
  const chY = sel.type === "pair" ? sel.y : 0;
  return invoke("set_spectrum_channel", { selType, chX, chY });
}

/** @param {number[] | null} weights */
export function setLoudnessWeights(weights) {
  return invoke("set_loudness_weights", { weights });
}

export function setDialogueGating(enabled) {
  return invoke("set_dialogue_gating", { enabled: !!enabled });
}
