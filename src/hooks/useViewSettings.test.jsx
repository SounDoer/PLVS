/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore } from "../persistence/index.js";
import { useViewSettings } from "./useViewSettings.js";

describe("useViewSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads default view settings", () => {
    const { result } = renderHook(() => useViewSettings());

    expect(result.current.focusView).toEqual({
      autoHideControls: false,
      compactPanels: false,
      borderless: false,
    });
    expect(result.current.panelOpacity).toBe(100);
    expect(result.current.glassEnabled).toBe(false);
  });

  it("persists view settings and marks the active preset dirty", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useViewSettings());

    act(() => {
      result.current.setAutoHideControls(true);
      result.current.setPanelOpacity(72);
      result.current.setGlassEnabled(true);
    });

    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toMatchObject({
      focusView: {
        autoHideControls: true,
        compactPanels: false,
        borderless: false,
      },
      panelOpacity: 72,
      glassEnabled: true,
    });
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("updates from settings storage events", async () => {
    const { result } = renderHook(() => useViewSettings());

    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({
        focusView: { autoHideControls: true, compactPanels: true, borderless: true },
        panelOpacity: 64,
        glassEnabled: true,
      })
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    });

    await waitFor(() => {
      expect(result.current.focusView).toEqual({
        autoHideControls: true,
        compactPanels: true,
        borderless: true,
      });
      expect(result.current.panelOpacity).toBe(64);
      expect(result.current.glassEnabled).toBe(true);
    });
  });
});
