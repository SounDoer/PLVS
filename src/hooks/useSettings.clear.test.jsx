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

describe("useSettings clear-shortcut wiring", () => {
  it("exposes clear-shortcut state with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.clearGlobal).toBe(false);
    expect(result.current.clearShortcut).toBe("CmdOrCtrl+K");
    expect(typeof result.current.setClearGlobal).toBe("function");
    expect(typeof result.current.setClearShortcut).toBe("function");
  });
});
