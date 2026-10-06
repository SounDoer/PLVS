/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider, useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { WindowChromeProvider } from "./WindowChromeContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { PresetsProvider, usePresetLibrary } from "./PresetsContext.jsx";

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
                      <PresetsProvider>{children}</PresetsProvider>
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

describe("PresetsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("saves the current scene as a preset and makes it active", async () => {
    const { result } = renderHook(() => usePresetLibrary(), { wrapper });

    await act(async () => {
      await result.current.save("Mix");
    });

    expect(result.current.list.map((preset) => preset.name)).toEqual(["Mix"]);
    expect(result.current.activeId).toBe(result.current.list[0].id);
    expect(result.current.dirty).toBe(false);
  });

  it("refuses to save while a blocking editor is open and changes nothing", async () => {
    const { result } = renderHook(
      () => {
        useBlockingEditor("theme", true);
        return { presets: usePresetLibrary(), workspace: useWorkspaceStore().state };
      },
      { wrapper }
    );
    const workspaceBefore = result.current.workspace;

    let refusal;
    await act(async () => {
      refusal = await result.current.presets.save("Mix").catch((error) => error);
    });

    expect(isSceneOperationRefused(refusal)).toBe(true);
    expect(result.current.presets.list).toEqual([]);
    expect(presetsStore.read().list ?? []).toEqual([]);
    expect(result.current.workspace).toBe(workspaceBefore);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => usePresetLibrary())).toThrow(
      "usePresetLibrary must be used inside PresetsProvider"
    );
  });
});
