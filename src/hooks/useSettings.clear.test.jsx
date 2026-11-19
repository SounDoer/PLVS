/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("keyboard shortcut configuration", () => {
  it("exposes the shortcut catalogue with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useKeyboardShortcuts({ current: null }));
    expect(result.current.keyboardShortcuts.clear).toEqual({
      accelerator: "CmdOrCtrl+3",
      global: false,
    });
    expect(typeof result.current.setShortcutGlobal).toBe("function");
    expect(typeof result.current.setShortcutAccelerator).toBe("function");
  });
});
