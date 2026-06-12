import { describe, it, expect } from "vitest";
import { dialogueOffsetText } from "./useLoudnessHistory.js";

describe("dialogueOffsetText", () => {
  it("shows a signed LU value when both operands are finite", () => {
    expect(dialogueOffsetText(-22, -20)).toBe("-2.0");
    expect(dialogueOffsetText(-18, -20)).toBe("+2.0");
  });
  it("shows em-dash when an operand is not finite", () => {
    expect(dialogueOffsetText(-Infinity, -20)).toBe("—");
    expect(dialogueOffsetText(-20, Infinity)).toBe("—");
  });
});
