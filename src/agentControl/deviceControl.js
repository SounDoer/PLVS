import {
  MAX_PUBLIC_DEVICE_LABEL_SCALARS,
  MAX_PUBLIC_DEVICE_ROWS,
} from "../runtime/deviceInventory.js";
import { deviceChannelChoices, findDeviceSource } from "../lib/channelSources.js";

const APPLICATION_ID = /^app-[0-9a-f]{32}$/;

/** Public application row: stable identity and label only, never process IDs or window titles. */
function applicationRow(application) {
  return {
    id: application.id,
    label: Array.from(application.label).slice(0, MAX_PUBLIC_DEVICE_LABEL_SCALARS).join(""),
    kind: "application",
    sampleRateHz: null,
    channelCount: null,
  };
}

function runningApplications(snapshot) {
  return (Array.isArray(snapshot.captureApplications) ? snapshot.captureApplications : []).filter(
    (application) => typeof application?.id === "string" && APPLICATION_ID.test(application.id)
  );
}

/** Find an exact device or running application among every source the GUI can select. */
function findSource(snapshot, id) {
  const device = findDeviceSource(snapshot.allDevices, id);
  if (device) return device;
  const application = runningApplications(snapshot).find((candidate) => candidate.id === id);
  return application ? applicationRow(application) : null;
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
  const device = automatic ? null : findSource(snapshot, requestedId);
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

/**
 * @param {string} code
 * @param {string} path
 * @param {string} message
 */
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
  const target = automatic ? null : findSource(snapshot, to);
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
  const applications = runningApplications(snapshot);
  return {
    generation: snapshot.generation,
    observedAt: snapshot.observedAt,
    automatic: {
      ...snapshot.automatic,
      resolved: snapshot.automatic.resolved
        ? Object.fromEntries(
            Object.entries(snapshot.automatic.resolved).filter(
              ([key]) => key !== "monitorSignature" && key !== "endpointId"
            )
          )
        : null,
    },
    devices: snapshot.devices.map(
      ({ monitorSignature: _monitorSignature, channelSelectors, ...device }) => ({
        ...device,
        ...(channelSelectors?.length
          ? { channelSources: deviceChannelChoices({ ...device, channelSelectors }) }
          : {}),
      })
    ),
    applications: applications.slice(0, MAX_PUBLIC_DEVICE_ROWS).map(applicationRow),
    truncated: snapshot.truncated || applications.length > MAX_PUBLIC_DEVICE_ROWS,
  };
}
