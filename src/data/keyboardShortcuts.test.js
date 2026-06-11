import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS } from "./keyboardShortcuts.js";

describe("KEYBOARD_SHORTCUTS", () => {
  it("lists the read-only shortcuts with startStop last and no clear row", () => {
    expect(KEYBOARD_SHORTCUTS.map((s) => s.id)).toEqual([
      "settings",
      "fullscreen",
      "exitFullscreen",
      "startStop",
    ]);
  });
  it("each row has a label and keys", () => {
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.keys).toBe("string");
    }
  });
});
