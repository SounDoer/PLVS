/**
 * Pure functions for audio engine device resolution.
 * Extracted from useAudioEngine so they can be tested without React or Tauri.
 */

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
    const d = devices.find((x) => x.id === captureDeviceId);
    if (d) return { device: d, isAutomatic: false };
  }
  const device =
    devices.find((d) => d.isSystemOutputMonitor) ||
    devices.find((d) => d.isLoopback) ||
    devices[0] ||
    null;
  return { device, isAutomatic: true };
}
