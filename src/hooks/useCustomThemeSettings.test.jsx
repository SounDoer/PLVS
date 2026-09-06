/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useThemeSettings } from "./useThemeSettings.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { upsertCustomTheme } from "../theme/customThemesRepo.js";
import { settingsStore, themesStore } from "../persistence/index.js";
import { themeRuntime } from "../theme/themeRuntime.js";
import { BlockingEditorsProvider, useBlockingEditors } from "./BlockingEditorsContext.jsx";

function mockMatchMedia(matches) {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderCustomThemeSettings(makeId) {
  return renderHook(() => {
    const themeSettings = useThemeSettings();
    return useCustomThemeSettings({
      themeSettings,
      setSettingsOpen: vi.fn(),
      makeId,
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

  it("commits GUI editor Save and command-grade create through identical planner state", () => {
    const document = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
    delete document.id;
    document.name = "Created";

    const command = renderCustomThemeSettings(() => "custom-created");
    act(() => command.result.current.themeControl.create(document));
    const commandState = command.result.current.themeControl.readState();
    command.unmount();

    localStorage.clear();
    const gui = renderCustomThemeSettings(() => "custom-created");
    act(() => gui.result.current.editor.beginCreate("Created"));
    act(() => gui.result.current.editor.save());

    expect(gui.result.current.themeControl.readState()).toEqual(commandState);
  });

  it("refuses conflicting control before state, persistence, preview, notification, or ID allocation", () => {
    const publish = vi.spyOn(themeRuntime, "publishAuthoring");
    const notify = vi.spyOn(themesStore, "notifyLocal");
    const makeId = vi.fn(() => "custom-command");
    const { result } = renderCustomThemeSettings(() => "custom-draft");
    act(() => result.current.editor.beginCreate("Draft"));
    publish.mockClear();
    notify.mockClear();
    const beforeState = structuredClone(result.current.themeControl.readState());
    const beforeDraft = structuredClone(result.current.editor.draft);
    const beforeSettings = settingsStore.read();
    const beforeThemes = themesStore.read();
    const { id: _id, ...document } = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);

    expect(() => result.current.themeControl.create(document, { makeId })).toThrow(
      /Finish or cancel/
    );
    expect(makeId).not.toHaveBeenCalled();
    expect(result.current.themeControl.readState()).toEqual(beforeState);
    expect(result.current.editor.draft).toEqual(beforeDraft);
    expect(settingsStore.read()).toEqual(beforeSettings);
    expect(themesStore.read()).toEqual(beforeThemes);
    expect(publish).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
