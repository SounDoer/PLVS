/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";

const mockSetAlwaysOnTop = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: mockSetAlwaysOnTop }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

// Keep persistence backed by localStorage so tests can seed/check it directly.
vi.mock("../persistence/index.js", () => {
  const settingsStore = {
    read: () => JSON.parse(localStorage.getItem("plvs:settings") ?? "{}"),
    patch: (partial) => {
      const prev = JSON.parse(localStorage.getItem("plvs:settings") ?? "{}");
      localStorage.setItem("plvs:settings", JSON.stringify({ ...prev, ...partial }));
    },
    subscribe: () => () => {},
  };
  return { settingsStore };
});

describe("useAlwaysOnTop", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetAlwaysOnTop.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("starts unpinned when localStorage is empty", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    expect(result.current.pinned).toBe(false);
  });

  it("starts pinned when localStorage has 'true'", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    const { result } = renderHook(() => useAlwaysOnTop());
    expect(result.current.pinned).toBe(true);
  });

  it("calls setAlwaysOnTop(false) on mount when unpinned", () => {
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop(true) on mount when restored from localStorage", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("togglePin flips pinned from false to true", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(true);
  });

  it("togglePin flips pinned from true to false", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(false);
  });

  it("togglePin writes new value to localStorage", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(true);
  });

  it("togglePin calls setAlwaysOnTop with new value", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    mockSetAlwaysOnTop.mockClear();
    act(() => result.current.togglePin());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
