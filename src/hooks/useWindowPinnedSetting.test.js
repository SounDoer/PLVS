/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWindowPinnedSetting } from "./useWindowPinnedSetting.js";

// Keep persistence backed by localStorage so tests can seed/check it directly.
vi.mock("../persistence/index.js", () => {
  const store = (key) => ({
    read: () => JSON.parse(localStorage.getItem(key) ?? "{}"),
    patch: (partial) => {
      const prev = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...prev, ...partial }));
    },
    subscribe: () => () => {},
  });
  return { presetsStore: store("plvs:presets"), settingsStore: store("plvs:settings") };
});

describe("useWindowPinnedSetting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts unpinned when nothing is stored", () => {
    const { result } = renderHook(() => useWindowPinnedSetting());
    expect(result.current.windowPinned).toBe(false);
  });

  it("starts from the stored value", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    const { result } = renderHook(() => useWindowPinnedSetting());
    expect(result.current.windowPinned).toBe(true);
  });

  it("stores an explicit value", () => {
    const { result } = renderHook(() => useWindowPinnedSetting());

    act(() => result.current.setWindowPinned(true));

    expect(result.current.windowPinned).toBe(true);
    expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(true);
  });

  it("treats anything but true as unpinned", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
    const { result } = renderHook(() => useWindowPinnedSetting());

    act(() => result.current.setWindowPinned("yes"));

    expect(result.current.windowPinned).toBe(false);
    expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(false);
  });

  it("marks the active preset dirty when pin state changes", () => {
    localStorage.setItem(
      "plvs:presets",
      JSON.stringify({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" })
    );
    const { result } = renderHook(() => useWindowPinnedSetting());

    act(() => result.current.setWindowPinned(true));

    const stored = JSON.parse(localStorage.getItem("plvs:presets"));
    expect(stored.activeId).toBe("p1");
    expect(stored.dirty).toBe(true);
  });
});
