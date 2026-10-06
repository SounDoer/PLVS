/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { useLoudnessProfileStats } from "./useLoudnessProfileStats.js";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>{children}</DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("useLoudnessProfileStats", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("unions the visible stats of every Stats surface in the default layout", () => {
    const { result } = renderHook(
      () => ({ stats: useLoudnessProfileStats(), workspace: useWorkspaceStore().state }),
      { wrapper }
    );
    const hasStatsPanel = Object.values(result.current.workspace.panelsById).some(
      (panel) => panel.moduleId === "stats"
    );

    expect(hasStatsPanel).toBe(true);
    expect(result.current.stats.visibleIds.length).toBeGreaterThan(0);
    expect(typeof result.current.stats.onShowMissing).toBe("function");
  });
});
