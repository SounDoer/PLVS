/// Scene operations are the ones that capture, replace or tear down the current editing scene:
/// applying, saving or updating a layout preset, and entering the dock. They are refused while a
/// blocking editor is open. See `hooks/BlockingEditorsContext.jsx` for the registry.
///
/// The refusal travels as an exception rather than a return value because these functions already
/// use `true` / `false` / `null` for ordinary outcomes -- preset not found, nothing to do -- and a
/// refusal is neither. Callers that render UI catch it; the App Control bridge maps `code` and
/// `operation` straight into its protocol error.

export const SCENE_OPERATION_BLOCKED_MESSAGE = "Finish or cancel the active editor first.";

export const SCENE_OPERATIONS = {
  presetApply: "preset.apply",
  presetSave: "preset.save",
  presetUpdate: "preset.update",
  dockEnter: "dock.enter",
};

/// `code` and `operation` are the stable contract on every refusal below. Nothing may branch on
/// `message`: it is user copy and will be reworded.
export class SceneOperationRefusedError extends Error {
  constructor(message, { operation, code }) {
    super(message);
    this.operation = operation;
    this.code = code;
  }
}

/// A draft-style editor is open. Recoverable by the user, and `editors` says what to finish.
export class SceneOperationBlockedError extends SceneOperationRefusedError {
  constructor(operation, editors) {
    super(SCENE_OPERATION_BLOCKED_MESSAGE, { operation, code: "editorActive" });
    this.name = "SceneOperationBlockedError";
    this.editors = [...editors];
  }
}

/// The current mode does not permit the operation at all -- not a missing capability (a platform
/// without dock support degrades instead), but a conflict with the state the app is in.
///
/// The message is per operation and reason because a refusal the user cannot act on is barely
/// better than none: it has to name both what was refused and what to change.
const UNAVAILABLE_MESSAGES = {
  "dock.enter:fileMode": "Dock is unavailable in FILE mode.",
  "preset.apply:fileMode": "Preset needs Dock, which is unavailable in FILE mode.",
};

const UNAVAILABLE_CODES = { fileMode: "fileModeActive" };

export class SceneOperationUnavailableError extends SceneOperationRefusedError {
  constructor(operation, reason) {
    super(UNAVAILABLE_MESSAGES[`${operation}:${reason}`] ?? "This is unavailable right now.", {
      operation,
      code: UNAVAILABLE_CODES[reason] ?? "operationUnavailable",
    });
    this.name = "SceneOperationUnavailableError";
    this.reason = reason;
  }
}

/// True for every refusal this module defines. Callers use it to show the refusal's own message
/// instead of a generic failure notice -- the refusals are the errors whose text is already
/// addressed to the user.
/// The mode rules, kept here rather than inline in App so they can be read and tested as rules.
/// Editors are not one of them: which editors are open is registry state, not a fact about the
/// mode, and lives in `hooks/BlockingEditorsContext.jsx`.
export function sceneOperationUnavailableReason(operation, { sourceMode } = {}) {
  // FILE mode forbids the dock outright. It is a state conflict rather than a missing capability,
  // so it refuses; a platform with no dock support degrades instead and reports no reason here.
  if (operation === SCENE_OPERATIONS.dockEnter && sourceMode === "file") return "fileMode";
  return null;
}

export function isSceneOperationRefused(error) {
  return error instanceof SceneOperationRefusedError;
}

export function isSceneOperationBlocked(error) {
  return error instanceof SceneOperationBlockedError;
}
