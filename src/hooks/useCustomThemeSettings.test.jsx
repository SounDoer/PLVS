/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useThemeSettings } from "./useThemeSettings.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { upsertCustomTheme } from "../theme/customThemesRepo.js";

function mockMatchMedia(matches) {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderCustomThemeSettings() {
  return renderHook(() => {
    const themeSettings = useThemeSettings();
    return useCustomThemeSettings({
      themeSettings,
      setSettingsOpen: vi.fn(),
    });
  });
}

describe("useCustomThemeSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = mockMatchMedia(true);
  });

  it("creates custom themes named Custom by default", () => {
    const { result } = renderCustomThemeSettings();

    act(() => {
      result.current.createCustomTheme();
    });

    expect(result.current.editor.draft.name).toBe("Custom");
  });

  it("persists normalized theme editor position", () => {
    const { result } = renderCustomThemeSettings();

    act(() => {
      result.current.moveEditor({ x: 24, y: 48 });
    });

    expect(result.current.editorPos).toEqual({ x: 24, y: 48 });
    expect(JSON.parse(localStorage.getItem("plvs:settings")).themeEditorPos).toEqual({
      x: 24,
      y: 48,
    });
  });

  it("customizes a builtin from its V2 authoring document", () => {
    const { result } = renderCustomThemeSettings();

    act(() => result.current.customizeBuiltinTheme("plvs-light"));

    expect(result.current.editor.draft).toMatchObject({
      name: "Light Custom",
      colorScheme: "light",
      core: BUILTIN_THEMES_V2["plvs-light"].core,
    });
  });

  it("falls back to the matching builtin scheme when deleting the selected theme", () => {
    const customLight = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-light"]),
      id: "custom-light",
      name: "Custom Light",
    };
    upsertCustomTheme(customLight);
    const { result } = renderHook(() => {
      const themeSettings = useThemeSettings();
      const custom = useCustomThemeSettings({ themeSettings, setSettingsOpen: vi.fn() });
      return { themeSettings, custom };
    });

    act(() => {
      result.current.themeSettings.setAppearance("fixed");
      result.current.themeSettings.setThemeId("custom-light");
    });
    act(() => result.current.custom.deleteCustomTheme("custom-light"));

    expect(result.current.themeSettings.themeId).toBe("plvs-light");
  });
});
