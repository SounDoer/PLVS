import { describe, it, expect } from "vitest";
import { isCustomThemeId, makeCustomThemeFromBase, normalizeCustomTheme } from "./customTheme.js";
import { BUILTIN_THEMES } from "./builtinThemes.js";

describe("isCustomThemeId", () => {
  it("is true only for the custom prefix", () => {
    expect(isCustomThemeId("custom-abc")).toBe(true);
    expect(isCustomThemeId("plvs-dark")).toBe(false);
    expect(isCustomThemeId(null)).toBe(false);
  });
});

describe("makeCustomThemeFromBase", () => {
  it("snapshots seeds/semantic/colormap/colorScheme from the base with a new id and name", () => {
    const base = BUILTIN_THEMES["plvs-dark"];
    const t = makeCustomThemeFromBase(base, "Sunset", () => "custom-fixed");
    expect(t.id).toBe("custom-fixed");
    expect(t.name).toBe("Sunset");
    expect(t.colorScheme).toBe("dark");
    expect(t.seeds.accent).toBe(base.seeds.accent);
    expect(t.seeds).not.toBe(base.seeds); // deep copy
    expect(t.semantic).toEqual(base.semantic);
    expect(t.semantic).not.toBe(base.semantic);
    expect(t.colormap).toEqual(base.colormap);
  });
});

describe("normalizeCustomTheme", () => {
  it("returns the theme for a valid object", () => {
    const base = BUILTIN_THEMES["plvs-light"];
    const t = makeCustomThemeFromBase(base, "Mine", () => "custom-1");
    expect(normalizeCustomTheme(t)).toEqual(t);
  });
  it("returns null for invalid input", () => {
    expect(normalizeCustomTheme(null)).toBeNull();
    expect(normalizeCustomTheme({ id: "plvs-dark" })).toBeNull(); // not a custom id
    expect(normalizeCustomTheme({ id: "custom-x" })).toBeNull(); // missing fields
  });
});
