import { describe, expect, it } from "vitest";
import { DOCK_ACCESSORY_HIDE_DELAY_MS, shouldShowDockHeader } from "./accessoryVisibility.js";

describe("dock accessory visibility", () => {
  it("uses the agreed 300ms hover bridge", () => {
    expect(DOCK_ACCESSORY_HIDE_DELAY_MS).toBe(300);
  });

  it.each([
    [{ stripInside: true, headerInside: false, editorOpen: false }, true],
    [{ stripInside: false, headerInside: true, editorOpen: false }, true],
    [{ stripInside: false, headerInside: false, editorOpen: true }, true],
    [{ stripInside: false, headerInside: false, editorOpen: false }, false],
  ])("derives visibility from all Dock surfaces", (presence, expected) => {
    expect(shouldShowDockHeader(presence)).toBe(expected);
  });
});
