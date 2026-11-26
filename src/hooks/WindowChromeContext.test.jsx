/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { WindowChromeProvider, useWindowChrome } from "./WindowChromeContext.jsx";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  setDecorations: vi.fn(),
  isDecorated: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../ipc/env.js", async (original) => ({
  ...(await original()),
  isTauri: native.isTauri,
}));
vi.mock("@tauri-apps/api/window", async (original) => ({
  ...(await original()),
  getCurrentWindow: () => ({
    isDecorated: native.isDecorated,
    setDecorations: native.setDecorations,
  }),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original()),
  invoke: native.invoke,
}));

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <UiNavigationProvider>
          <SettingsProvider>
            <SceneGuardProvider>
              <DockProvider>
                <WindowChromeProvider>{children}</WindowChromeProvider>
              </DockProvider>
            </SceneGuardProvider>
          </SettingsProvider>
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("WindowChromeProvider", () => {
  beforeEach(() => {
    native.isTauri.mockReturnValue(false);
    native.invoke.mockReset().mockResolvedValue(undefined);
    native.setDecorations.mockReset();
    native.isDecorated.mockReset();
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
    document.documentElement.style.removeProperty("--surface-opacity");
    document.documentElement.style.removeProperty("--dock-surface-opacity");
  });

  it("stores a view change through the settings owner", async () => {
    const { result } = renderHook(
      () => ({ chrome: useWindowChrome(), settings: useAppSettings() }),
      { wrapper }
    );

    act(() => result.current.chrome.setPinned(true));
    await waitFor(() => expect(result.current.settings.windowPinned).toBe(true));
    act(() => result.current.chrome.setCompactPanels(true));
    await waitFor(() => expect(result.current.settings.focusView.compactPanels).toBe(true));

    expect(result.current.chrome.view.pinned).toBe(true);
    expect(result.current.chrome.focusViewActive).toBe(true);
  });

  it("persists Views switches and keeps panel axes independent of header visibility", async () => {
    const { result, unmount } = renderHook(() => useWindowChrome(), { wrapper });
    await act(async () => {
      result.current.setPanelPresentation({
        workspace: { hidePanelHeaders: true, hideAxesAndLabels: true },
        dock: { hideAxesAndLabels: false },
      });
    });
    await act(async () => {
      result.current.setCompactPanels(false);
      result.current.setAutoHideControls(true);
      result.current.setBorderless(true);
    });
    unmount();

    const restored = renderHook(() => useWindowChrome(), { wrapper });
    await act(async () => {});
    expect(restored.result.current.view.focusView).toEqual({
      autoHideControls: true,
      compactPanels: false,
      borderless: true,
    });
    expect(restored.result.current.view.panelPresentation).toEqual({
      workspace: { hidePanelHeaders: false, hideAxesAndLabels: true },
      dock: { hideAxesAndLabels: false },
    });
  });

  it("keeps both Views switches when a second change arrives during a native update", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });
    let decorated = true;
    native.isTauri.mockReturnValue(true);
    native.isDecorated.mockImplementation(async () => decorated);
    native.setDecorations.mockImplementation(async (value) => {
      decorated = value;
    });
    let release;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    act(() => result.current.setBorderless(true));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    act(() => result.current.setAutoHideControls(true));
    expect(result.current.view.focusView.autoHideControls).toBe(false);
    await act(async () => release());

    expect(result.current.view.focusView).toMatchObject({
      autoHideControls: true,
      borderless: true,
    });
    expect(native.setDecorations.mock.calls).toEqual([[false]]);
    expect(settingsStore.read().focusView).toMatchObject({
      autoHideControls: true,
      borderless: true,
    });
  });

  it("publishes surface opacity as a CSS variable", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });

    act(() => result.current.setSurfaceOpacity(40));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--surface-opacity")).toBe("40%")
    );
  });

  it("resets the current window's view settings while preserving the Dock's view settings", async () => {
    settingsStore.patch({
      windowPinned: true,
      focusView: { autoHideControls: true, compactPanels: true, borderless: true },
      panelPresentation: {
        workspace: { hidePanelHeaders: true, hideAxesAndLabels: true },
        dock: { hideAxesAndLabels: true },
      },
      surfaceOpacity: 40,
      dockSurfaceOpacity: 25,
    });
    const { result } = renderHook(() => useWindowChrome(), { wrapper });
    expect(result.current.canResetWindowView).toBe(true);

    await act(() => result.current.resetWindowView());

    expect(result.current.canResetWindowView).toBe(false);
    expect(result.current.view).toMatchObject({
      pinned: false,
      focusView: { autoHideControls: false, compactPanels: false, borderless: false },
      panelPresentation: {
        workspace: { hidePanelHeaders: false, hideAxesAndLabels: false },
        dock: { hideAxesAndLabels: true },
      },
      surfaceOpacity: 100,
      dockSurfaceOpacity: 25,
    });
    settingsStore.flush();
    expect(settingsStore.read()).toMatchObject({
      windowPinned: false,
      surfaceOpacity: 100,
      dockSurfaceOpacity: 25,
    });
  });

  it("keeps the last slider value and applies native shadow changes in order", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });
    let finishZero;
    native.invoke.mockImplementation((command, args) =>
      command === "sync_surface_opacity_shadow" && args.surfaceOpacity === 0
        ? new Promise((resolve) => {
            finishZero = resolve;
          })
        : Promise.resolve()
    );
    native.isTauri.mockReturnValue(true);

    act(() => result.current.setSurfaceOpacity(0));
    await waitFor(() => expect(finishZero).toEqual(expect.any(Function)));
    act(() => result.current.setSurfaceOpacity(25));
    expect(result.current.view.surfaceOpacity).toBe(25);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    await act(async () => finishZero());
    await waitFor(() =>
      expect(native.invoke).toHaveBeenNthCalledWith(2, "sync_surface_opacity_shadow", {
        surfaceOpacity: 100,
      })
    );
    settingsStore.flush();
    expect(settingsStore.read().surfaceOpacity).toBe(25);
    expect(result.current.view.surfaceOpacity).toBe(25);
  });

  it("restores the native frame when window chrome sync fails", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });
    let decorated = true;
    native.isTauri.mockReturnValue(true);
    native.isDecorated.mockImplementation(async () => decorated);
    native.setDecorations.mockImplementation(async (value) => {
      decorated = value;
    });
    native.invoke.mockRejectedValueOnce(new Error("native sync failed"));

    await act(async () => {
      await expect(
        result.current.applyViewState(
          { focusView: { autoHideControls: false, borderless: true } },
          { changed: ["view.focusView.borderless"] }
        )
      ).rejects.toMatchObject({
        message: "native sync failed",
        rollback: "completed",
        partial: false,
      });
    });
    expect(native.setDecorations.mock.calls).toEqual([[false], [true]]);
    expect(decorated).toBe(true);
    expect(result.current.view.focusView.borderless).toBe(false);
  });

  it("publishes Dock surface opacity as its own CSS variable", async () => {
    const { result } = renderHook(
      () => ({ chrome: useWindowChrome(), settings: useAppSettings() }),
      { wrapper }
    );

    act(() => result.current.chrome.setDockSurfaceOpacity(25));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--dock-surface-opacity")).toBe("25%")
    );
    expect(result.current.settings.dockSurfaceOpacity).toBe(25);
    expect(result.current.chrome.view.dockSurfaceOpacity).toBe(25);
    expect(result.current.chrome.view.surfaceOpacity).toBe(100);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useWindowChrome())).toThrow(
      "useWindowChrome must be used inside WindowChromeProvider"
    );
  });
});
