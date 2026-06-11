import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS } from "./keyboardShortcuts.js";

describe("KEYBOARD_SHORTCUTS", () => {
  it("lists the five existing shortcuts in order", () => {
    expect(KEYBOARD_SHORTCUTS.map((s) => s.id)).toEqual([
      "startStop",
      "clear",
      "settings",
      "fullscreen",
      "exitFullscreen",
    ]);
  });
  it("each row has a label and keys", () => {
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.keys).toBe("string");
    }
  });
});
