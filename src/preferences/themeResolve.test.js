import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ID,
  parsePersistedUiStateJson,
  resolveThemeId,
  THEME_IDS,
} from "./themeResolve.js";

describe("resolveThemeId", () => {
  it("resolves to plvs-dark for system dark preference", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, true)).toBe("plvs-dark");
  });

  it("resolves to plvs-light for system light preference", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, false)).toBe("plvs-light");
  });

  it("ignores stored themeId when appearance is system", () => {
    expect(resolveThemeId({ appearance: "system", themeId: "plvs-dark" }, true)).toBe("plvs-dark");
  });

  it("uses stored themeId when appearance is fixed and valid", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: "plvs-dark" }, true)).toBe("plvs-dark");
    expect(resolveThemeId({ appearance: "fixed", themeId: "plvs-light" }, false)).toBe(
      "plvs-light"
    );
  });

  it("falls back to plvs-dark for fixed appearance with missing or invalid themeId", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: null }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "" }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false)).toBe(
      DEFAULT_THEME_ID
    );
    expect(resolveThemeId({ appearance: "fixed", themeId: "unknown-theme" }, false)).toBe(
      DEFAULT_THEME_ID
    );
  });

  it("defaults appearance to system when fields missing", () => {
    expect(resolveThemeId({}, true)).toBe("plvs-dark");
    expect(resolveThemeId({}, false)).toBe("plvs-light");
  });
});

describe("parsePersistedUiStateJson", () => {
  it("defaults appearance system and themeId null for empty or invalid JSON", () => {
    expect(parsePersistedUiStateJson(null)).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("")).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("not-json")).toEqual({ appearance: "system", themeId: null });
  });

  it("reads appearance and themeId when present", () => {
    expect(
      parsePersistedUiStateJson(JSON.stringify({ appearance: "fixed", themeId: "plvs-dark" }))
    ).toEqual({ appearance: "fixed", themeId: "plvs-dark" });
  });

  it("legacy uiMode-only blobs are ignored", () => {
    expect(parsePersistedUiStateJson(JSON.stringify({ uiMode: "dark" }))).toEqual({
      appearance: "system",
      themeId: null,
    });
  });
});

describe("resolveThemeId DEV warnings", () => {
  it("warns in DEV for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does not warn in production for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", false);
    resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("THEME_IDS", () => {
  it("contains plvs-dark and plvs-light", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).not.toContain("audiometer-dark");
    expect(THEME_IDS).not.toContain("audiometer-light");
    expect(THEME_IDS).not.toContain("audiometer-ember");
  });
});
