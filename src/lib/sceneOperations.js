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

/// `code` and `operation` are the stable contract. Nothing may branch on `message`: it is user
/// copy and will be reworded.
export class SceneOperationBlockedError extends Error {
  constructor(operation, editors) {
    super(SCENE_OPERATION_BLOCKED_MESSAGE);
    this.name = "SceneOperationBlockedError";
    this.code = "editorActive";
    this.operation = operation;
    this.editors = [...editors];
  }
}

export function isSceneOperationBlocked(error) {
  return error instanceof SceneOperationBlockedError;
}
