export const MAX_PUBLIC_DEVICE_ROWS = 256;
export const MAX_PUBLIC_DEVICE_LABEL_SCALARS = 512;

/**
 * @param {string} value
 */
function boundedLabel(value) {
  const label = typeof value === "string" && value.trim() ? value.trim() : "Unknown device";
  return Array.from(label).slice(0, MAX_PUBLIC_DEVICE_LABEL_SCALARS).join("");
}

function positiveIntegerOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeDevice(device) {
  const id = typeof device?.id === "string" ? device.id : "";
  if (!id) throw new Error("Audio device inventory contains an empty device ID.");
  const systemOutput = device.isSystemOutputMonitor === true;
  return {
    id,
    label: boundedLabel(device.label),
    kind: systemOutput ? "systemOutput" : "input",
    direction: systemOutput ? "output" : "input",
    loopback: systemOutput || device.isLoopback === true,
    sampleRateHz: positiveIntegerOrNull(device.defaultSampleRate),
    channelCount: positiveIntegerOrNull(device.channels),
    ...(Array.isArray(device.channelSelectors) && device.channelSelectors.length
      ? { channelSelectors: device.channelSelectors }
      : {}),
    ...(typeof device.monitorSignature === "string"
      ? { monitorSignature: device.monitorSignature }
      : {}),
  };
}

function normalizeAutomatic(preview) {
  const available =
    preview != null &&
    Number.isFinite(preview.sampleRateHz) &&
    preview.sampleRateHz > 0 &&
    Number.isFinite(preview.channels) &&
    preview.channels > 0;
  return {
    id: "default",
    label: "Automatic",
    available,
    resolved: available
      ? {
          label: boundedLabel(preview.label),
          ...(typeof preview.endpointId === "string" ? { endpointId: preview.endpointId } : {}),
          sampleRateHz: positiveIntegerOrNull(preview.sampleRateHz),
          channelCount: positiveIntegerOrNull(preview.channels),
          ...(typeof preview.monitorSignature === "string"
            ? { monitorSignature: preview.monitorSignature }
            : {}),
        }
      : null,
  };
}

function inventorySignature(devices, automatic) {
  return JSON.stringify({ automatic, devices });
}

/** Normalize one coherent native inventory/Automatic-preview observation. */
export function normalizeDeviceInventory(nativeDevices, automaticPreview, observedAt = new Date()) {
  const devices = (Array.isArray(nativeDevices) ? nativeDevices : []).map(normalizeDevice);
  const ids = new Set();
  for (const device of devices) {
    if (ids.has(device.id)) {
      throw new Error(`Audio device inventory contains duplicate ID ${device.id}.`);
    }
    ids.add(device.id);
  }
  const automatic = normalizeAutomatic(automaticPreview);
  return {
    observedAt:
      observedAt instanceof Date ? observedAt.toISOString() : new Date(observedAt).toISOString(),
    automatic,
    devices: devices.slice(0, MAX_PUBLIC_DEVICE_ROWS),
    truncated: devices.length > MAX_PUBLIC_DEVICE_ROWS,
    allDevices: devices,
    signature: inventorySignature(devices, automatic),
  };
}

/** Advance the process-local inventory generation only when normalized observable data changes. */
export function advanceDeviceGeneration(previous, inventory) {
  const same = previous?.signature === inventory.signature;
  return {
    ...inventory,
    generation: same ? previous.generation : (previous?.generation ?? 0) + 1,
  };
}
