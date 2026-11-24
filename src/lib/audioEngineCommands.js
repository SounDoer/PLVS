/**
 * Pure functions for audio engine device resolution.
 * Extracted from useAudioEngine so they can be tested without React or Tauri.
 */
import { findDeviceSource } from "./channelSources.js";

/**
 * Given the device list from the native engine and a persisted captureDeviceId preference,
 * returns the device that should actually be used for capture.
 *
 * @param {Array<{id: string, isSystemOutputMonitor?: boolean, isLoopback?: boolean}>} devices
 * @param {string} captureDeviceId
 * @returns {{ device: object | null, isAutomatic: boolean }}
 */
export function resolveDevice(devices, captureDeviceId) {
  const isAutomatic = !captureDeviceId || captureDeviceId === "default";
  if (!isAutomatic) {
    return {
      device: findDeviceSource(devices, captureDeviceId),
      isAutomatic: false,
    };
  }
  const device =
    devices.find((d) => d.isSystemOutputMonitor) ||
    devices.find((d) => d.isLoopback) ||
    devices[0] ||
    null;
  return { device, isAutomatic: true };
}
