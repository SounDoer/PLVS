export const DOCK_ACCESSORY_EVENTS = Object.freeze({
  state: "dock-accessory://state",
  action: "dock-accessory://action",
  focus: "dock-accessory://focus",
  ready: "dock-accessory://ready",
});

export const DOCK_ACCESSORY_SURFACES = Object.freeze([
  "dock-header",
  "dock-editor",
  "dock-update",
  "dock-import",
]);

const ACTION_TYPES = new Set([
  "import-paste",
  "import-ready",
  "import-resize",
  "import-confirm",
  "import-dismiss",
  "import-action",
  "update-ready",
  "update-resize",
  "update-confirm",
  "update-dismiss",
  "update-link",
  "update-preferences-change",
  "update-preferences-save",
  "update-preferences-skip",
  "header-ready",
  "source-primary",
  "clear",
  "open-update",
  "open-editor",
  "close-editor",
  "dismiss-toolbar",
  "resize-editor",
  "set-edge",
  "set-hide-axes-labels",
  "select-device",
  "toggle-reserve-space",
  "restore-window",
  "toggle-module",
  "add-module",
  "rename-module",
  "remove-module",
  "reorder-module",
  "reset-modules",
  "hover-module",
  "open-module-settings",
  "update-module-controls",
  "update-time-viewport",
  "update-frequency-viewport",
  "reset-module-controls",
  "apply-preset",
  "save-preset",
  "update-preset",
  "rename-preset",
  "delete-preset",
  "reorder-preset",
  "select-loudness-profile",
  "reorder-loudness-profiles",
]);

/**
 * @param {string} value
 */
export function isDockAccessorySurface(value) {
  return DOCK_ACCESSORY_SURFACES.includes(value);
}

/**
 * @param {string} surface
 */
export function createAccessorySnapshot(surface, revision, payload) {
  if (!isDockAccessorySurface(surface)) return null;
  return {
    surface,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

/**
 * @param {number} currentRevision
 * @param {string} surface
 */
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

export function normalizeAccessoryFocus(raw) {
  if (!raw || !isDockAccessorySurface(raw.surface) || typeof raw.focused !== "boolean") {
    return null;
  }
  return { surface: raw.surface, focused: raw.focused };
}
