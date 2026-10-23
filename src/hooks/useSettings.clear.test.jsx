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

describe("useSettings keyboard shortcut wiring", () => {
  it("exposes the shortcut catalogue with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.keyboardShortcuts.clear).toEqual({
      accelerator: "CmdOrCtrl+K",
      global: false,
    });
    expect(typeof result.current.setShortcutGlobal).toBe("function");
    expect(typeof result.current.setShortcutAccelerator).toBe("function");
  });
});
