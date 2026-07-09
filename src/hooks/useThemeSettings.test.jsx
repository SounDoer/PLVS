/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeSettings } from "./useThemeSettings.js";

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
