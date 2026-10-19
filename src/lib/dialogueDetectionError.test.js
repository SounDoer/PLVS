import { describe, expect, it } from "vitest";
import { dialogueDetectionErrorMessage } from "./dialogueDetectionError.js";

describe("dialogueDetectionErrorMessage", () => {
  it("tells an overloaded detector apart from a failed one and says how to restart it", () => {
    expect(dialogueDetectionErrorMessage("detectorOverloaded")).toBe(
      "Dialogue Detection could not keep up and stopped. Programme loudness is still available; Clear restarts it."
    );
    expect(dialogueDetectionErrorMessage("runtimeFailed")).toBe(
      "Dialogue Detection stopped. Programme loudness is still available."
    );
  });
});
