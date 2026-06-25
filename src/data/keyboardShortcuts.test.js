import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS, reservedComboConflict } from "./keyboardShortcuts.js";

describe("KEYBOARD_SHORTCUTS", () => {
  it("lists the read-only shortcuts with startStop last and no clear row", () => {
    expect(KEYBOARD_SHORTCUTS.map((s) => s.id)).toEqual([
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

describe("reservedComboConflict", () => {
  it("returns null for all current combos (no modifier-bearing shortcuts remain)", () => {
    expect(reservedComboConflict("CmdOrCtrl+,")).toBeNull();
    expect(reservedComboConflict("CmdOrCtrl+K")).toBeNull();
    expect(reservedComboConflict("CmdOrCtrl+Alt+J")).toBeNull();
  });
});
