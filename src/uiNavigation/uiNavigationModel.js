export const UI_SETTINGS_SECTIONS = Object.freeze([
  "behavior",
  "shortcuts",
  "appearance",
  "analysis",
  "channels",
  "transfer",
  "agent-control",
  "about",
]);

export const UI_SURFACE_KINDS = Object.freeze([
  "settings",
  "panelSettings",
  "themeEditor",
  "loudnessProfileEditor",
  "feedback",
  "update",
  "crashReport",
  "closeConfirmation",
  "libraryConflict",
  "confirmation",
  "libraryExport",
  "importReview",
  "importComplete",
  "nativeError",
]);

export const UI_SURFACE_ORIGINS = Object.freeze(["navigable", "event", "nested"]);
export const UI_SURFACE_ACTIONS = Object.freeze(["close", "cancel"]);
export const UI_NAVIGATION_ERROR_CODES = Object.freeze([
  "uiGenerationConflict",
  "uiSurfaceNotFound",
  "uiTargetNotFound",
  "uiTargetNotVisible",
  "surfaceUnavailable",
  "uiActionUnavailable",
  "uiConflict",
  "uiBusy",
  "uiNotSettled",
]);

const UI_ERROR_MESSAGES = Object.freeze({
  uiGenerationConflict: "The visible UI changed after it was inspected.",
  uiSurfaceNotFound: "The requested UI surface is no longer open.",
  uiTargetNotFound: "The requested UI target does not exist.",
  uiTargetNotVisible: "The requested UI target is not currently visible.",
  surfaceUnavailable: "The requested UI surface is unavailable in the current window form.",
  uiActionUnavailable: "The requested action is unavailable for this UI surface.",
  uiConflict: "Another UI surface prevents this navigation action.",
  uiBusy: "The requested UI surface is busy.",
  uiNotSettled: "The requested UI surface did not settle in time.",
});

const UI_ERROR_DETAIL_FIELDS = Object.freeze([
  "expectedUiGeneration",
  "currentUiGeneration",
  "surfaceId",
  "kind",
  "action",
  "panelId",
  "section",
  "windowForm",
]);

export function createUiNavigationError(reason, details = {}) {
  if (!UI_NAVIGATION_ERROR_CODES.includes(reason)) {
    throw new Error(`Unknown UI Navigation error: ${reason}`);
  }
  const publicDetails = {};
  for (const field of UI_ERROR_DETAIL_FIELDS) {
    const value = details[field];
    if (typeof value === "number" && Number.isFinite(value)) publicDetails[field] = value;
    if (typeof value === "string" && value.length <= 128) publicDetails[field] = value;
  }
  return Object.assign(new Error(UI_ERROR_MESSAGES[reason]), {
    reason,
    details: publicDetails,
  });
}

export function createUiNavigationState() {
  return Object.freeze({ uiGeneration: 0, surfaces: Object.freeze([]) });
}

/** @param {() => string} [randomUuid] */
export function createUiSurfaceId(randomUuid = () => globalThis.crypto.randomUUID()) {
  const entropy = String(randomUuid())
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  if (entropy.length < 16) throw new Error("UI surface entropy is invalid.");
  return `ui-${entropy}`;
}

const PUBLIC_TARGET_FIELDS = Object.freeze([
  "intent",
  "panelId",
  "themeId",
  "profileId",
  "draftId",
  "section",
  "page",
  "phase",
  "presentation",
]);

function projectTarget(target) {
  const projected = {};
  for (const field of PUBLIC_TARGET_FIELDS) {
    if (target?.[field] !== undefined) projected[field] = target[field];
  }
  return projected;
}

function projectSurface(surface) {
  if (!UI_SURFACE_KINDS.includes(surface.kind)) throw new Error("UI surface kind is invalid.");
  if (!UI_SURFACE_ORIGINS.includes(surface.origin))
    throw new Error("UI surface origin is invalid.");
  if (!/^ui-[a-z0-9-]{16,60}$/.test(surface.surfaceId ?? "")) {
    throw new Error("UI surface ID is invalid.");
  }
  const projected = {
    surfaceId: surface.surfaceId,
    kind: surface.kind,
    origin: surface.origin,
    blocking: Boolean(surface.blocking),
  };
  for (const field of ["dirty", "stale", "busy"]) {
    if (surface[field] !== undefined) projected[field] = Boolean(surface[field]);
  }
  projected.dismissible = Boolean(surface.dismissible);
  projected.supportedActions = Object.freeze(
    [
      ...new Set(
        (surface.supportedActions ?? []).filter((action) => UI_SURFACE_ACTIONS.includes(action))
      ),
    ].sort()
  );
  projected.target = Object.freeze(projectTarget(surface.target));
  return Object.freeze(projected);
}

export function mountUiSurface(state, surface) {
  const projected = projectSurface(surface);
  const existingIndex = state.surfaces.findIndex(
    (candidate) => candidate.surfaceId === projected.surfaceId
  );
  if (
    existingIndex >= 0 &&
    JSON.stringify(state.surfaces[existingIndex]) === JSON.stringify(projected)
  ) {
    return state;
  }
  const surfaces = [...state.surfaces];
  if (existingIndex >= 0) surfaces[existingIndex] = projected;
  else surfaces.push(projected);
  return Object.freeze({
    uiGeneration: state.uiGeneration + 1,
    surfaces: Object.freeze(surfaces),
  });
}

export function unmountUiSurface(state, surfaceId) {
  if (!state.surfaces.some((surface) => surface.surfaceId === surfaceId)) return state;
  return Object.freeze({
    uiGeneration: state.uiGeneration + 1,
    surfaces: Object.freeze(state.surfaces.filter((surface) => surface.surfaceId !== surfaceId)),
  });
}

export function focusUiSurface(state, surfaceId) {
  const index = state.surfaces.findIndex((surface) => surface.surfaceId === surfaceId);
  if (index < 0 || index === state.surfaces.length - 1) return state;
  const surfaces = [...state.surfaces];
  const [surface] = surfaces.splice(index, 1);
  surfaces.push(surface);
  return Object.freeze({
    uiGeneration: state.uiGeneration + 1,
    surfaces: Object.freeze(surfaces),
  });
}

export function projectUiInspection(state, { workbench, window, activeBlockingEditors }) {
  return {
    uiGeneration: state.uiGeneration,
    workbench,
    window,
    activeBlockingEditors,
    topSurfaceId: state.surfaces.at(-1)?.surfaceId ?? null,
    surfaces: state.surfaces,
  };
}
