/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSettings } from "./useSettings.js";

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
      expect(result.current.resolvedThemeId).toBe("audiometer-dark");
    });
    expect(result.current.appearance).toBe("system");
    act(() => {
      result.current.setAppearanceMode("fixed");
    });
    expect(result.current.appearance).toBe("fixed");
    expect(result.current.themeId).toBe("audiometer-dark");
  });

  it("seeds audiometer-light when system prefers light", async () => {
    window.matchMedia = mockMatchMedia(false);
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("audiometer-light");
    });
    act(() => {
      result.current.setAppearanceMode("fixed");
    });
    expect(result.current.themeId).toBe("audiometer-light");
  });
});
