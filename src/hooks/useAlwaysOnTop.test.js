/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";

const mockSetAlwaysOnTop = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrent: () => ({ setAlwaysOnTop: mockSetAlwaysOnTop }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

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
    localStorage.setItem("plvs:windowPinned", "true");
    const { result } = renderHook(() => useAlwaysOnTop());
    expect(result.current.pinned).toBe(true);
  });

  it("calls setAlwaysOnTop(false) on mount when unpinned", () => {
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop(true) on mount when restored from localStorage", () => {
    localStorage.setItem("plvs:windowPinned", "true");
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("togglePin flips pinned from false to true", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(true);
  });

  it("togglePin flips pinned from true to false", () => {
    localStorage.setItem("plvs:windowPinned", "true");
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(false);
  });

  it("togglePin writes new value to localStorage", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(localStorage.getItem("plvs:windowPinned")).toBe("true");
  });

  it("togglePin calls setAlwaysOnTop with new value", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    mockSetAlwaysOnTop.mockClear();
    act(() => result.current.togglePin());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
