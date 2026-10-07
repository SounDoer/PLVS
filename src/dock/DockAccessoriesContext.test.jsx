/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { WindowChromeProvider } from "../hooks/WindowChromeContext.jsx";
import { PresetsProvider } from "../hooks/PresetsContext.jsx";
import { SourceProvider } from "../runtime/SourceContext.jsx";
import { SourceActionsProvider } from "../runtime/SourceActionsContext.jsx";
import { AppLifecycleProvider } from "../hooks/AppLifecycleContext.jsx";
import { DisplaySnapshotProvider } from "../runtime/DisplaySnapshotContext.jsx";
import { AnalysisSessionProvider } from "../runtime/AnalysisSessionContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { DockProvider } from "./DockContext.jsx";
import { DockAccessoriesProvider, useDockAccessories } from "./DockAccessoriesContext.jsx";

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
                            <AppLifecycleProvider>
                              <DisplaySnapshotProvider>
                                <AnalysisSessionProvider>
                                  <DockAccessoriesProvider>{children}</DockAccessoriesProvider>
                                </AnalysisSessionProvider>
                              </DisplaySnapshotProvider>
                            </AppLifecycleProvider>
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

describe("DockAccessoriesProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("reports no accessory and the normal-form capture targets when not docked", () => {
    const { result } = renderHook(() => useDockAccessories(), { wrapper });

    expect(result.current.visibility.editorView).toBeNull();
    expect(result.current.hoveredDockPanelId).toBeNull();
    expect(result.current.visualRuntimeRef.current).toMatchObject({
      windowForm: "normal",
      sourceMode: "live",
      availableScreenshotTargets: ["main", "workspace", "panel"],
      availableAudioSources: ["none", "measuredSource"],
    });
    expect(result.current.visualRuntimeRef.current.accessoryGeometry.dockEditor.visible).toBe(
      false
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDockAccessories())).toThrow(
      "useDockAccessories must be used inside DockAccessoriesProvider"
    );
  });
});
