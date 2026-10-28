/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { DockProvider, useDock } from "./DockContext.jsx";

const { resizeDockHeight } = vi.hoisted(() => ({ resizeDockHeight: vi.fn() }));
vi.mock("../hooks/useDockMode.js", async (importOriginal) => {
  const actual = /** @type {typeof import("../hooks/useDockMode.js")} */ (await importOriginal());
  return {
    ...actual,
    useDockMode: (...args) => ({ ...actual.useDockMode(...args), resizeDockHeight }),
  };
});

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <UiNavigationProvider>
          <SettingsProvider>
            <SceneGuardProvider>
              <DockProvider>{children}</DockProvider>
            </SceneGuardProvider>
          </SettingsProvider>
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("DockProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
    resizeDockHeight.mockReset().mockResolvedValue(180);
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("reports the normal window form outside Tauri and exposes the layout", () => {
    const { result } = renderHook(() => useDock(), { wrapper });

    expect(result.current.docked).toBe(false);
    expect(result.current.dockEnabled).toBe(false);
    expect(Array.isArray(result.current.layout.panels)).toBe(true);
    expect(typeof result.current.exitDockRestoringAttributes).toBe("function");
    expect(typeof result.current.onDockChange).toBe("function");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDock())).toThrow("useDock must be used inside DockProvider");
  });

  it("enables Reset Layout when only the height differs from the default", () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { height: 240 } };
    const { result } = renderHook(() => useDock(), { wrapper });
    expect(result.current.layout.isDefault).toBe(true);
    expect(result.current.layoutIsDefault).toBe(false);
  });

  it("restores the default height before replacing a custom module layout", async () => {
    const { result } = renderHook(() => useDock(), { wrapper });
    act(() => result.current.layout.removePanel("stats"));
    let resolveHeight;
    resizeDockHeight.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHeight = resolve;
        })
    );
    let pending;
    act(() => {
      pending = result.current.resetDockLayout();
    });
    expect(resizeDockHeight).toHaveBeenCalledWith(180, { persist: true });
    expect(result.current.layout.panels.some(({ id }) => id === "stats")).toBe(false);
    await act(async () => {
      resolveHeight(180);
      await pending;
    });
    expect(result.current.layout.panels.some(({ id }) => id === "stats")).toBe(true);
  });

  it("keeps the module layout when restoring the native height fails", async () => {
    const { result } = renderHook(() => useDock(), { wrapper });
    act(() => result.current.layout.removePanel("stats"));
    const previous = workspaceStore.read().dock;
    resizeDockHeight.mockRejectedValueOnce(new Error("resize rejected"));
    await act(async () => {
      await result.current.resetDockLayout();
    });
    expect(workspaceStore.read().dock).toEqual(previous);
  });
});
