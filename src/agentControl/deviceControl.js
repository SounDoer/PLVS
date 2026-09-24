export const MAX_PUBLIC_DEVICE_ROWS = 256;
export const MAX_PUBLIC_DEVICE_LABEL_SCALARS = 512;

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
          sampleRateHz: positiveIntegerOrNull(preview.sampleRateHz),
          channelCount: positiveIntegerOrNull(preview.channels),
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

function resolvedExact(device) {
  return device
    ? {
        id: device.id,
        label: device.label,
        kind: device.kind,
        sampleRateHz: device.sampleRateHz,
        channelCount: device.channelCount,
      }
    : null;
}

function resolvedAutomatic(automatic) {
  return automatic.resolved
    ? {
        id: null,
        label: automatic.resolved.label,
        kind: "systemOutput",
        sampleRateHz: automatic.resolved.sampleRateHz,
        channelCount: automatic.resolved.channelCount,
      }
    : null;
}

/** Build the public selection and Live relationship from the owner's coherent snapshot. */
export function buildDeviceInspection(snapshot, live = {}) {
  const requestedId = snapshot.requestedId || "default";
  const automatic = requestedId === "default";
  const device = automatic
    ? null
    : (snapshot.allDevices.find((candidate) => candidate.id === requestedId) ?? null);
  const state = live.state ?? (live.running ? "running" : "stopped");
  const transition =
    live.transition ?? (state === "starting" || state === "stopping" ? state : null);
  const running = state === "running";
  const usingRequestedSelection =
    running &&
    transition === null &&
    (typeof live.usingRequestedSelection === "boolean"
      ? live.usingRequestedSelection
      : live.requestedDeviceId === requestedId);

  return {
    generation: snapshot.generation,
    observedAt: snapshot.observedAt,
    selection: {
      requestedId,
      mode: automatic ? "automatic" : "exact",
      available: automatic ? snapshot.automatic.available : device !== null,
      resolved: automatic ? resolvedAutomatic(snapshot.automatic) : resolvedExact(device),
      transition: snapshot.migrationState?.state ?? null,
    },
    live: {
      running,
      transition,
      usingRequestedSelection,
    },
  };
}

function issue(code, path, message, details) {
  return { code, path, message, ...(details ? { details } : {}) };
}

function emptyPlan(from, to) {
  return {
    changed: false,
    effects: [],
    warnings: [],
    confirmationsRequired: [],
    issues: [],
    refusal: null,
    plan: { from, to, restartLive: false },
  };
}

/** Plan exact-ID/default selection without touching React, persistence, File state, or capture. */
export function planDeviceSelection(snapshot, params, live = {}) {
  const from = snapshot.requestedId || "default";
  const to = params.deviceId;
  const result = emptyPlan(from, to);

  if (params.expectedGeneration !== snapshot.generation) {
    result.issues.push(
      issue("deviceInventoryChanged", "$.expectedGeneration", "The device inventory changed.", {
        expectedGeneration: params.expectedGeneration,
        currentGeneration: snapshot.generation,
      })
    );
    return result;
  }

  const liveState = live.state ?? (live.running ? "running" : "stopped");
  const liveTransition = live.transition ?? null;
  if (liveTransition || ["starting", "stopping", "restarting"].includes(liveState)) {
    result.refusal = {
      code: "transitionInProgress",
      state: liveTransition ?? liveState,
    };
    return result;
  }

  const automatic = to === "default";
  const target = automatic
    ? null
    : (snapshot.allDevices.find((device) => device.id === to) ?? null);
  if (!automatic && !target) {
    result.issues.push(issue("deviceNotFound", "$.deviceId", `Device ${to} was not found.`));
    return result;
  }

  if (to === from) return result;

  const running = liveState === "running";
  const available = automatic ? snapshot.automatic.available : target !== null;
  if (!available && running) {
    result.issues.push(
      issue("deviceUnavailable", "$.deviceId", "The requested device is currently unavailable.")
    );
    return result;
  }

  result.changed = true;
  result.plan.restartLive = running;
  if (!available) result.warnings.push("automaticCurrentlyUnavailable");
  if (running) {
    result.effects.push("measurementRestart");
    if (params.allowMeasurementRestart !== true) {
      result.confirmationsRequired.push("allowMeasurementRestart");
    }
  }
  return result;
}

/** Return the bounded public list shape while retaining full rows only inside the owner. */
export function buildDeviceList(snapshot) {
  return {
    generation: snapshot.generation,
    observedAt: snapshot.observedAt,
    automatic: snapshot.automatic,
    devices: snapshot.devices,
    truncated: snapshot.truncated,
  };
}
