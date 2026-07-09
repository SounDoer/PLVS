/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useThemeSettings } from "./useThemeSettings.js";

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
});
