/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { presetsStore } from "../persistence/index.js";
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

  it("names newly-created custom themes Custom by default", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-dark");
    });

    act(() => {
      result.current.createCustomTheme();
    });

    expect(result.current.editor.draft.name).toBe("Custom");
  });

  it("exposes no loudness reference: the active Loudness Profile owns it", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -14 }));
    const { result } = renderHook(() => useSettings());

    expect(result.current).not.toHaveProperty("referenceLufs");
    expect(result.current).not.toHaveProperty("setReferenceLufs");
    // The stored key stays put: profileShape still round-trips it for old config files.
    expect(JSON.parse(localStorage.getItem("plvs:settings")).referenceLufs).toBe(-14);
  });

  it("persists appearance and themeId from the settings hook", async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.resolvedThemeId).toBe("plvs-dark");
    });

    act(() => {
      result.current.setAppearanceMode("fixed");
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("plvs:settings"))).toMatchObject({
        appearance: "fixed",
        themeId: "plvs-dark",
      });
    });
  });

  it("persists interface size without theme changes resetting it", async () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setInterfaceSize("extra-large");
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("plvs:settings")).interfaceSize).toBe("extra-large");
      expect(document.documentElement.style.getPropertyValue("--ui-fs-body")).toBe("19px");
    });

    act(() => {
      result.current.setAppearanceMode("fixed");
    });

    await waitFor(() => {
      expect(result.current.interfaceSize).toBe("extra-large");
      expect(document.documentElement.style.getPropertyValue("--ui-fs-body")).toBe("19px");
    });
  });

  it("owns sanitized channel-label overrides", async () => {
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({
        channelLabelOverrides: {
          2: ["L", "R"],
          3: ["L", "bad", "R"],
        },
      })
    );
    const { result } = renderHook(() => useSettings());
    expect(result.current.channelLabelOverrides).toEqual({ 2: ["L", "R"] });

    act(() => {
      result.current.setChannelLabelOverrides({ 1: ["M"] });
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("plvs:settings")).channelLabelOverrides).toEqual({
        1: ["M"],
      });
    });
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

  it("defaults Focus View options to off", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.focusView).toEqual({
      autoHideControls: false,
      compactPanels: false,
      borderless: false,
    });
  });

  it("reads persisted Focus View options", () => {
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ focusView: { autoHideControls: true, compactPanels: true } })
    );
    const { result } = renderHook(() => useSettings());
    expect(result.current.focusView).toEqual({
      autoHideControls: true,
      compactPanels: true,
      borderless: false,
    });
  });

  it("normalizes malformed Focus View options", () => {
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ focusView: { autoHideControls: "yes", compactPanels: 1 } })
    );
    const { result } = renderHook(() => useSettings());
    expect(result.current.focusView).toEqual({
      autoHideControls: false,
      compactPanels: false,
      borderless: false,
    });
  });

  it("persists Focus View toggles and marks the active preset dirty", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoHideControls(true);
    });

    expect(JSON.parse(localStorage.getItem("plvs:settings")).focusView).toEqual({
      autoHideControls: true,
      compactPanels: false,
      borderless: false,
    });
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);

    act(() => {
      result.current.setCompactPanels(true);
    });

    expect(JSON.parse(localStorage.getItem("plvs:settings")).focusView).toEqual({
      autoHideControls: true,
      compactPanels: true,
      borderless: false,
    });
  });

  it("updates Focus View state from storage events", async () => {
    const { result } = renderHook(() => useSettings());

    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ focusView: { autoHideControls: true, compactPanels: false } })
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    });

    await waitFor(() => {
      expect(result.current.focusView).toEqual({
        autoHideControls: true,
        compactPanels: false,
        borderless: false,
      });
    });
  });
});
