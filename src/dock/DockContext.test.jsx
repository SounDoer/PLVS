/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { DockProvider, useDock } from "./DockContext.jsx";

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
});
