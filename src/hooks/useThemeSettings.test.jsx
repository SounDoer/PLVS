/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeSettings } from "./useThemeSettings.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { themesStore } from "../persistence/index.js";
import { themeRuntime } from "../theme/themeRuntime.js";

function mockMatchMedia(matches) {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("useThemeSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = mockMatchMedia(true);
  });

  it("keeps the applied snapshot on external refresh and falls back after external deletion", () => {
    const original = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-shared",
      name: "Shared",
    };
    themesStore.patch({ themes: { [original.id]: original }, order: [original.id] });
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ appearance: "fixed", themeId: original.id })
    );
    const { result } = renderHook(() => useThemeSettings());
    const changed = { ...original, core: { ...original.core, workspace: "#123456" } };
    act(() => {
      themesStore.patch({ themes: { [original.id]: changed } });
      themesStore.notifyLocal();
    });
    expect(result.current.customThemes[original.id].core.workspace).toBe("#123456");
    expect(result.current.resolvedTheme.core.workspace).toBe(original.core.workspace);
    expect(themeRuntime.getSnapshot().css["--background"]).toBe(original.core.workspace);
    act(() => result.current.setCustomThemesFromController([changed]));
    expect(themeRuntime.getSnapshot().css["--background"]).toBe("#123456");
    act(() => {
      themesStore.patch({ themes: {}, order: [] });
      themesStore.notifyLocal();
    });
    expect(result.current.resolvedThemeId).toBe("plvs-dark");
    expect(themeRuntime.getSnapshot().id).toBe("plvs-dark");
  });

  it("resolves the system theme from dark mode", async () => {
    const { result } = renderHook(() => useThemeSettings());

    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-dark");
    });
    expect(result.current.appearance).toBe("system");
  });

  it("seeds the resolved builtin when switching from system to fixed", async () => {
    const { result } = renderHook(() => useThemeSettings());

    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-dark");
    });
    act(() => {
      result.current.setAppearanceMode("fixed");
    });

    expect(result.current.appearance).toBe("fixed");
    expect(result.current.themeId).toBe("plvs-dark");
  });

  it("persists fixed theme selection", async () => {
    const { result } = renderHook(() => useThemeSettings());

    act(() => {
      result.current.setFixedThemeIdFromPicker("plvs-light");
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("plvs:settings"))).toMatchObject({
        appearance: "fixed",
        themeId: "plvs-light",
      });
    });
  });

  it("updates from settings storage events", async () => {
    const { result } = renderHook(() => useThemeSettings());

    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ appearance: "fixed", themeId: "plvs-light" })
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    });

    await waitFor(() => {
      expect(result.current.appearance).toBe("fixed");
      expect(result.current.themeId).toBe("plvs-light");
      expect(result.current.resolvedThemeId).toBe("plvs-light");
    });
  });
});
