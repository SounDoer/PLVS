import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ID,
  parsePersistedUiStateJson,
  resolveThemeId,
  THEME_IDS,
} from "./themeResolve.js";

describe("resolveThemeId", () => {
  it("uses OS mapping when appearance is system (dark)", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, true)).toBe("audiometer-dark");
  });

  it("uses OS mapping when appearance is system (light)", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, false)).toBe("audiometer-light");
  });

  it("ignores stored themeId when appearance is system", () => {
    expect(resolveThemeId({ appearance: "system", themeId: "audiometer-light" }, true)).toBe("audiometer-dark");
  });

  it("uses stored themeId when appearance is fixed and valid", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: "audiometer-light" }, true)).toBe("audiometer-light");
    expect(resolveThemeId({ appearance: "fixed", themeId: "audiometer-ember" }, false)).toBe("audiometer-ember");
  });

  it("falls back to audiometer-dark for fixed appearance with missing or invalid themeId", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: null }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "" }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "unknown-theme" }, false)).toBe(DEFAULT_THEME_ID);
  });

  it("defaults appearance to system and themeId to null when fields missing", () => {
    expect(resolveThemeId({}, true)).toBe("audiometer-dark");
    expect(resolveThemeId({}, false)).toBe("audiometer-light");
  });
});

describe("parsePersistedUiStateJson", () => {
  it("defaults appearance system and themeId null for empty or invalid JSON", () => {
    expect(parsePersistedUiStateJson(null)).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("")).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("not-json")).toEqual({ appearance: "system", themeId: null });
  });

  it("reads appearance and themeId when present", () => {
    expect(parsePersistedUiStateJson(JSON.stringify({ appearance: "fixed", themeId: "audiometer-light" }))).toEqual({
      appearance: "fixed",
      themeId: "audiometer-light",
    });
  });

  it("legacy uiMode-only blobs are ignored (no migration)", () => {
    expect(parsePersistedUiStateJson(JSON.stringify({ uiMode: "dark" }))).toEqual({
      appearance: "system",
      themeId: null,
    });
  });
});

describe("resolveThemeId DEV warnings", () => {
  it("warns only in DEV for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    resolveThemeId({ appearance: "fixed", themeId: "not-a-real-theme" }, false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does not warn in production for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", false);
    resolveThemeId({ appearance: "fixed", themeId: "not-a-real-theme" }, false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("THEME_IDS", () => {
  it("lists known builtin ids", () => {
    expect(THEME_IDS).toContain("audiometer-dark");
    expect(THEME_IDS).toContain("audiometer-light");
    expect(THEME_IDS).toContain("audiometer-ember");
  });
});
