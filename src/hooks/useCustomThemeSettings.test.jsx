/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useThemeSettings } from "./useThemeSettings.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { upsertCustomTheme } from "../theme/customThemesRepo.js";
import { BlockingEditorsProvider, useBlockingEditors } from "./BlockingEditorsContext.jsx";

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

/// The theme editor is a blocking editor: its draft is published as a live preview, and a preset
/// apply or a dock entry would close the panel and take the unsaved theme with it.
describe("useCustomThemeSettings registers a blocking editor", () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = mockMatchMedia(true);
  });

  function renderWithRegistry() {
    return renderHook(
      () => {
        const themeSettings = useThemeSettings();
        return {
          settings: useCustomThemeSettings({ themeSettings, setSettingsOpen: vi.fn() }),
          registry: useBlockingEditors(),
        };
      },
      { wrapper: ({ children }) => <BlockingEditorsProvider>{children}</BlockingEditorsProvider> }
    );
  }

  it("registers while the editor is open and clears on cancel", () => {
    const { result } = renderWithRegistry();
    expect(result.current.registry.activeBlockingEditors).toEqual([]);

    act(() => result.current.settings.createCustomTheme());

    // Open, not dirty: nothing has been typed into the new theme yet.
    expect(result.current.registry.activeBlockingEditors).toEqual(["theme"]);
    expect(() => result.current.registry.assertSceneOperationAllowed("preset.apply")).toThrow(
      /Finish or cancel/
    );

    act(() => result.current.settings.editor.cancel());

    expect(result.current.registry.activeBlockingEditors).toEqual([]);
  });

  it("clears the registration on save", () => {
    const { result } = renderWithRegistry();
    act(() => result.current.settings.createCustomTheme());
    act(() => result.current.settings.editor.save());

    expect(result.current.registry.activeBlockingEditors).toEqual([]);
  });
});

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
