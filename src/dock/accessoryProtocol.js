export const DOCK_ACCESSORY_EVENTS = Object.freeze({
  state: "dock-accessory://state",
  action: "dock-accessory://action",
  pointer: "dock-accessory://pointer",
  ready: "dock-accessory://ready",
});

export const DOCK_ACCESSORY_SURFACES = Object.freeze(["dock-header", "dock-editor"]);

const ACTION_TYPES = new Set([
  "source-primary",
  "clear",
  "open-editor",
  "close-editor",
  "resize-editor",
  "set-edge",
  "toggle-reserve-space",
  "restore-window",
  "toggle-module",
  "add-module",
  "rename-module",
  "remove-module",
  "reorder-module",
  "hover-module",
  "open-module-settings",
  "update-module-controls",
  "reset-module-controls",
  "apply-preset",
  "save-preset",
  "update-preset",
  "rename-preset",
  "delete-preset",
]);

export function isDockAccessorySurface(value) {
  return DOCK_ACCESSORY_SURFACES.includes(value);
}

export function createAccessorySnapshot(surface, revision, payload) {
  if (!isDockAccessorySurface(surface)) return null;
  return {
    surface,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

export function acceptAccessorySnapshot(currentRevision, snapshot, surface) {
  if (
    snapshot?.surface !== surface ||
    !Number.isSafeInteger(snapshot?.revision) ||
    snapshot.revision <= currentRevision ||
    !snapshot.payload ||
    typeof snapshot.payload !== "object"
  ) {
    return null;
  }
  return snapshot;
}

export function normalizeAccessoryAction(raw) {
  if (
    !raw ||
    !isDockAccessorySurface(raw.surface) ||
    !ACTION_TYPES.has(raw.type) ||
    (raw.revision !== undefined && !Number.isSafeInteger(raw.revision))
  ) {
    return null;
  }
  return {
    surface: raw.surface,
    type: raw.type,
    revision: raw.revision ?? 0,
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : {},
  };
}

export function normalizeAccessoryPointer(raw) {
  if (!raw || !isDockAccessorySurface(raw.surface) || typeof raw.inside !== "boolean") {
    return null;
  }
  return { surface: raw.surface, inside: raw.inside };
}
