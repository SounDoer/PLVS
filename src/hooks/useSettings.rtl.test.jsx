/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSettings } from "./useSettings.js";
import { UI_PREFERENCES } from "../uiPreferences";

function mockMatchMedia(matches) {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("useSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = mockMatchMedia(true);
  });

  it("seeds themeId to resolved dark builtin when switching system to fixed (ADR 0002 §6)", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-dark");
    });
    expect(result.current.appearance).toBe("system");
    act(() => {
      result.current.setAppearanceMode("fixed");
    });
    expect(result.current.appearance).toBe("fixed");
    expect(result.current.themeId).toBe("plvs-dark");
  });

  it("seeds plvs-light when system prefers light", async () => {
    window.matchMedia = mockMatchMedia(false);
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-light");
    });
    act(() => {
      result.current.setAppearanceMode("fixed");
    });
    expect(result.current.themeId).toBe("plvs-light");
  });

  it("defaults referenceLufs to -23 when localStorage is empty", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    expect(result.current.referenceLufs).toBe(-23);
  });

  it("reads referenceLufs from localStorage", () => {
    localStorage.setItem(UI_PREFERENCES.layoutPersistKey, JSON.stringify({ referenceLufs: -14 }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.referenceLufs).toBe(-14);
  });

  it("resets referenceLufs to -23 when stored value is out of range", () => {
    localStorage.setItem(UI_PREFERENCES.layoutPersistKey, JSON.stringify({ referenceLufs: 5 }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.referenceLufs).toBe(-23);
  });

  it("defaults closeAction to 'ask' when localStorage key is absent", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    expect(result.current.closeAction).toBe("ask");
  });

  it("reads closeAction from localStorage on mount", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.closeAction).toBe("tray");
  });

  it("setCloseAction to 'tray' writes to localStorage and updates state", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setCloseAction("tray");
    });
    expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("tray");
    expect(result.current.closeAction).toBe("tray");
  });

  it("setCloseAction to 'ask' removes the key from localStorage", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "quit" }));
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setCloseAction("ask");
    });
    expect(JSON.parse(localStorage.getItem("plvs:settings") ?? "{}").closeAction).toBeUndefined();
    expect(result.current.closeAction).toBe("ask");
  });
});
