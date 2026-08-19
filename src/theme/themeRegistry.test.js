import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { makeCustomThemeV2FromBase } from "./customTheme.js";
import { getTheme, isKnownThemeId } from "./themeRegistry.js";

const custom = makeCustomThemeV2FromBase(BUILTIN_THEMES_V2["plvs-dark"], "C", () => "custom-1");
const customs = { "custom-1": custom };

describe("themeRegistry", () => {
  it("resolves builtins and customs", () => {
    expect(getTheme("plvs-light", customs)).toBe(BUILTIN_THEMES_V2["plvs-light"]);
    expect(getTheme("custom-1", customs)).toBe(custom);
  });
  it("falls back to plvs-dark for unknown", () => {
    expect(getTheme("nope", customs)).toBe(BUILTIN_THEMES_V2["plvs-dark"]);
    expect(getTheme("custom-1", {})).toBe(BUILTIN_THEMES_V2["plvs-dark"]);
  });
  it("isKnownThemeId reflects builtins and customs", () => {
    expect(isKnownThemeId("plvs-dark", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", {})).toBe(false);
    expect(isKnownThemeId("nope", customs)).toBe(false);
  });
});
