/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
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

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAppLifecycle())).toThrow(
      "useAppLifecycle must be used inside AppLifecycleProvider"
    );
  });
});
