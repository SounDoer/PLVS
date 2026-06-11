/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSettings } from "./useSettings.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("useSettings global-clear wiring", () => {
  it("exposes global-clear state with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.globalClearEnabled).toBe(false);
    expect(result.current.globalClearShortcut).toBe("CmdOrCtrl+Alt+K");
    expect(typeof result.current.setGlobalClearEnabled).toBe("function");
    expect(typeof result.current.setGlobalClearShortcut).toBe("function");
  });
});
