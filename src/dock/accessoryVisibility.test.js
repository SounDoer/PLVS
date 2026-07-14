import { describe, expect, it } from "vitest";
import { shouldShowDockHeader } from "./accessoryVisibility.js";

describe("dock accessory visibility", () => {
  it.each([
    [{ stripInside: true, headerInside: false, editorOpen: false }, true],
    [{ stripInside: false, headerInside: true, editorOpen: false }, true],
    [{ stripInside: false, headerInside: false, editorOpen: true }, true],
    [{ stripInside: false, headerInside: false, editorOpen: false, forceVisible: true }, true],
    [{ stripInside: false, headerInside: false, editorOpen: false }, false],
  ])("derives visibility from all Dock surfaces", (presence, expected) => {
    expect(shouldShowDockHeader(presence)).toBe(expected);
  });
});
