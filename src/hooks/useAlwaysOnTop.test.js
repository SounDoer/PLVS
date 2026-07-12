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
  const presetsStore = {
    read: () => JSON.parse(localStorage.getItem("plvs:presets") ?? "{}"),
    patch: (partial) => {
      const prev = JSON.parse(localStorage.getItem("plvs:presets") ?? "{}");
      localStorage.setItem("plvs:presets", JSON.stringify({ ...prev, ...partial }));
    },
    subscribe: () => () => {},
  };
  return { presetsStore, settingsStore };
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

  it("setPinned writes and applies an explicit value", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    mockSetAlwaysOnTop.mockClear();
    act(() => result.current.setPinned(true));
    expect(result.current.pinned).toBe(true);
    expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(true);
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("marks the active preset dirty when pin state changes", () => {
    localStorage.setItem(
      "plvs:presets",
      JSON.stringify({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" })
    );
    const { result } = renderHook(() => useAlwaysOnTop());

    act(() => result.current.setPinned(true));

    const stored = JSON.parse(localStorage.getItem("plvs:presets"));
    expect(stored.activeId).toBe("p1");
    expect(stored.dirty).toBe(true);
  });

  it("skips setAlwaysOnTop while suspended (docked strip keeps Rust-owned topmost)", () => {
    const { result } = renderHook(() => useAlwaysOnTop({ suspended: true }));
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();

    act(() => result.current.setPinned(false));

    // The stored value still updates; only the window call is gated.
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(false);
  });

  it("re-asserts the stored pin when unsuspended (dock exit)", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    const { rerender } = renderHook(({ suspended }) => useAlwaysOnTop({ suspended }), {
      initialProps: { suspended: true },
    });
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();

    rerender({ suspended: false });
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
