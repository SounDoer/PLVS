import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES } from "./builtinThemes.js";
import { makeCustomThemeFromBase } from "./customTheme.js";
import { getTheme, isKnownThemeId } from "./themeRegistry.js";

const custom = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], "C", () => "custom-1");
const customs = { "custom-1": custom };

describe("themeRegistry", () => {
  it("resolves builtins and customs", () => {
    expect(getTheme("plvs-light", customs)).toBe(BUILTIN_THEMES["plvs-light"]);
    expect(getTheme("custom-1", customs)).toBe(custom);
  });
  it("falls back to plvs-dark for unknown", () => {
    expect(getTheme("nope", customs)).toBe(BUILTIN_THEMES["plvs-dark"]);
    expect(getTheme("custom-1", {})).toBe(BUILTIN_THEMES["plvs-dark"]);
  });
  it("isKnownThemeId reflects builtins and customs", () => {
    expect(isKnownThemeId("plvs-dark", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", {})).toBe(false);
    expect(isKnownThemeId("nope", customs)).toBe(false);
  });
});
