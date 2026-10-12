import { describe, expect, it } from "vitest";
import { shouldShowDockHeader } from "./accessoryVisibility.js";

describe("dock accessory visibility", () => {
  it.each([
    [{ userOpen: true, editorOpen: false }, true],
    [{ userOpen: false, editorOpen: true }, true],
    [{ userOpen: false, editorOpen: false, forceVisible: true }, true],
    [{ userOpen: false, editorOpen: false }, false],
  ])("shows the header only on request, for an editor, or for an error", (input, expected) => {
    expect(shouldShowDockHeader(input)).toBe(expected);
  });
});
