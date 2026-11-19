/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { settingsStore } from "../persistence/index.js";
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
    expect(result.current.surfaceOpacity).toBe(100);
    expect(result.current.glassEnabled).toBe(false);
    expect(result.current.dockSurfaceOpacity).toBe(100);
  });

  it("keeps Dock surface opacity apart from the Workspace's", async () => {
    const { result } = renderHook(() => useViewSettings());

    act(() => result.current.setDockSurfaceOpacity(35.6));

    expect(result.current.dockSurfaceOpacity).toBe(36);
    expect(result.current.surfaceOpacity).toBe(100);
    // A slider drag coalesces its writes.
    await waitFor(() => expect(settingsStore.read()).toMatchObject({ dockSurfaceOpacity: 36 }));
  });

  it("persists opacity and glass settings", () => {
    const { result } = renderHook(() => useViewSettings());

    act(() => {
      result.current.setSurfaceOpacity(72);
      result.current.setGlassEnabled(true);
    });

    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toMatchObject({
      surfaceOpacity: 72,
      glassEnabled: true,
    });
  });

  it("updates from settings storage events", async () => {
    const { result } = renderHook(() => useViewSettings());

    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({
        focusView: { autoHideControls: true, compactPanels: true, borderless: true },
        surfaceOpacity: 64,
        dockSurfaceOpacity: 30,
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
      expect(result.current.surfaceOpacity).toBe(64);
      expect(result.current.dockSurfaceOpacity).toBe(30);
      expect(result.current.glassEnabled).toBe(true);
    });
  });

  it("keeps locally dragged opacities when another workbench changes a shared preference", () => {
    settingsStore.patch({ surfaceOpacity: 65, dockSurfaceOpacity: 50, quickTour: "pending" });
    const { result } = renderHook(() => useViewSettings());
    act(() => {
      result.current.setSurfaceOpacity(25);
      result.current.setDockSurfaceOpacity(0);
    });
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({ ...settingsStore.read(), quickTour: "dismissed" })
    );
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" })));
    act(() => settingsStore.flush());

    expect(result.current).toMatchObject({ surfaceOpacity: 25, dockSurfaceOpacity: 0 });
    expect(settingsStore.read()).toMatchObject({
      surfaceOpacity: 25,
      dockSurfaceOpacity: 0,
      quickTour: "dismissed",
    });
  });
});
