import { describe, expect, it } from "vitest";
import {
  SCENE_OPERATIONS,
  SceneOperationBlockedError,
  SceneOperationUnavailableError,
  isSceneOperationBlocked,
  isSceneOperationRefused,
  sceneOperationUnavailableReason,
} from "./sceneOperations.js";

describe("sceneOperationUnavailableReason", () => {
  it("refuses dock entry in FILE mode", () => {
    expect(
      sceneOperationUnavailableReason(SCENE_OPERATIONS.dockEnter, { sourceMode: "file" })
    ).toBe("fileMode");
  });

  it("allows dock entry in LIVE mode", () => {
    expect(
      sceneOperationUnavailableReason(SCENE_OPERATIONS.dockEnter, { sourceMode: "live" })
    ).toBe(null);
  });

  it("says nothing about the operations FILE mode does not conflict with", () => {
    for (const operation of [
      SCENE_OPERATIONS.presetApply,
      SCENE_OPERATIONS.presetSave,
      SCENE_OPERATIONS.presetUpdate,
    ]) {
      expect(sceneOperationUnavailableReason(operation, { sourceMode: "file" })).toBe(null);
    }
  });
});

describe("scene operation refusals", () => {
  it("names the editors that block an operation", () => {
    const error = new SceneOperationBlockedError(SCENE_OPERATIONS.presetApply, ["theme"]);
    expect(error.code).toBe("editorActive");
    expect(error.operation).toBe("preset.apply");
    expect(error.editors).toEqual(["theme"]);
    expect(error.message).toBe("Finish or cancel the active editor first.");
  });

  it("words an unavailable operation for the entry point it was refused at", () => {
    // Same reason, two operations: the user has to be told what was refused, not only why.
    expect(new SceneOperationUnavailableError(SCENE_OPERATIONS.dockEnter, "fileMode").message).toBe(
      "Dock is unavailable in FILE mode."
    );
    expect(
      new SceneOperationUnavailableError(SCENE_OPERATIONS.presetApply, "fileMode").message
    ).toBe("Preset needs Dock, which is unavailable in FILE mode.");
  });

  it("carries a stable code and reason so nothing has to parse the message", () => {
    const error = new SceneOperationUnavailableError(SCENE_OPERATIONS.dockEnter, "fileMode");
    expect(error.code).toBe("fileModeActive");
    expect(error.reason).toBe("fileMode");
    expect(error.operation).toBe("dock.enter");
  });

  it("recognizes both refusals, and only refusals", () => {
    const blocked = new SceneOperationBlockedError(SCENE_OPERATIONS.dockEnter, ["theme"]);
    const unavailable = new SceneOperationUnavailableError(SCENE_OPERATIONS.dockEnter, "fileMode");

    expect(isSceneOperationRefused(blocked)).toBe(true);
    expect(isSceneOperationRefused(unavailable)).toBe(true);
    expect(isSceneOperationRefused(new Error("apply_dock_form failed"))).toBe(false);
    // Blocked stays narrower: only an open editor is something the user can finish or cancel.
    expect(isSceneOperationBlocked(unavailable)).toBe(false);
  });
});
