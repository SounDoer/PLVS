import { describe, expect, it, vi } from "vitest";
import { errorDetails } from "./errorDetails.js";
import { reportSceneOperationError } from "./sceneOperationNotice.js";
import { SCENE_OPERATIONS, SceneOperationBlockedError } from "./sceneOperations.js";

describe("errorDetails", () => {
  it("joins a prefix with the error message", () => {
    expect(errorDetails("Dock failed", new Error("no monitor"))).toBe("Dock failed: no monitor");
    expect(errorDetails("Dock failed", "plain")).toBe("Dock failed: plain");
  });
});

describe("reportSceneOperationError", () => {
  it("shows a refusal's own sentence without technical detail", () => {
    const raiseNotice = vi.fn();
    const refusal = new SceneOperationBlockedError(SCENE_OPERATIONS.presetApply, ["theme"]);

    reportSceneOperationError(raiseNotice, refusal, "Preset failed.", "Preset failed");

    expect(raiseNotice).toHaveBeenCalledWith("error", refusal.message);
  });

  it("shows the fallback line with detail for a genuine failure", () => {
    const raiseNotice = vi.fn();

    reportSceneOperationError(raiseNotice, new Error("ipc"), "Preset failed.", "Preset failed");

    expect(raiseNotice).toHaveBeenCalledWith("error", "Preset failed.", "Preset failed: ipc");
  });
});
