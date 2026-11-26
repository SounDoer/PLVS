/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "../runtime/MeterRuntimeContext.jsx";
import { useRuntimeCoordination } from "../runtime/coordination.js";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { WindowChromeProvider } from "./WindowChromeContext.jsx";
import { PresetsProvider } from "./PresetsContext.jsx";
import { SourceProvider } from "../runtime/SourceContext.jsx";
import { SourceActionsProvider } from "../runtime/SourceActionsContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { AppLifecycleProvider, useAppLifecycle } from "./AppLifecycleContext.jsx";

vi.mock("../runtime/coordination.js", async (original) => ({
  ...(await original()),
  useRuntimeCoordination: vi.fn(),
}));

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>
                    <WindowChromeProvider>
                      <PresetsProvider>
                        <SourceProvider>
                          <SourceActionsProvider>
                            <AppLifecycleProvider>{children}</AppLifecycleProvider>
                          </SourceActionsProvider>
                        </SourceProvider>
                      </PresetsProvider>
                    </WindowChromeProvider>
                  </DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("AppLifecycleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("starts visible, idle and with no dialog open", () => {
    const { result } = renderHook(() => useAppLifecycle(), { wrapper });

    expect(result.current.windowVisible).toBe(true);
    expect(result.current.updateBusy).toBe(false);
    expect(result.current.closeConfirm.dialogOpen).toBe(false);
    expect(result.current.crashReporting.pendingReport ?? null).toBeNull();
    expect(typeof result.current.updateControls.refreshUpdateCheck).toBe("function");
  });

  it("briefly outlines the workbench after Locate and replays the cue on another Locate", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAppLifecycle(), { wrapper });
      const locate = vi.mocked(useRuntimeCoordination).mock.lastCall[0].actions.locate;
      const outline = () => document.querySelector(".workbench-locate");
      expect(outline()).toBeNull();

      await act(() => locate());
      const firstCue = outline();
      expect(firstCue?.getAttribute("aria-hidden")).toBe("true");
      act(() => vi.advanceTimersByTime(800));
      await act(() => locate());
      expect(outline()).not.toBe(firstCue);
      act(() => vi.advanceTimersByTime(800));
      expect(outline()).toBeTruthy();
      act(() => vi.advanceTimersByTime(400));
      expect(outline()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the active File with the local shortcut before Live has ever run", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });
    act(() => result.current.switchSource("file"));
    act(() => result.current.beginFileAnalysis("/tmp/selected.wav", {}));
    await act(() => result.current.stopFileAnalysis());
    expect(result.current.activeFileSession).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "3",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(result.current.activeFileSession).toBeNull();
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAppLifecycle())).toThrow(
      "useAppLifecycle must be used inside AppLifecycleProvider"
    );
  });

  it("refuses coordination while Live is starting and waits for native stop once running", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    await act(async () => result.current.runtime.startLive());
    const coordination = () => vi.mocked(useRuntimeCoordination).mock.lastCall[0];

    await expect(coordination().stop()).rejects.toMatchObject({ code: "transitionInProgress" });

    await act(async () => result.current.assembly.transport.markStarted());
    const settled = vi.fn();
    let stopping;
    await act(async () => {
      stopping = coordination().stop().then(settled);
    });
    expect(result.current.runtime.liveLifecycle).toBe("stopping");
    expect(settled).not.toHaveBeenCalled();
    await act(async () => {
      result.current.assembly.transport.markStopped();
      await stopping;
    });
    expect(settled).toHaveBeenCalledOnce();
  });
});
