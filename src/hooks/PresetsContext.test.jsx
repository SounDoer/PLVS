/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
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
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
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

/// An installation that has run before: a stored workspace is what tells it from a first run.
function storeExistingWorkspace() {
  workspaceStore.patch({
    tree: DEFAULT_WORKSPACE_STATE.tree,
    panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
    panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
  });
}

describe("PresetsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("saves the first-run scene as the active Default preset", async () => {
    const { result } = renderHook(
      () => ({ presets: usePresetLibrary(), workspace: useWorkspaceStore().state }),
      { wrapper }
    );
    await act(async () => {});

    const { presets, workspace } = result.current;
    expect(presets.list.map((preset) => preset.name)).toEqual(["Default"]);
    expect(presets.activeId).toBe(presets.list[0].id);
    expect(presets.dirty).toBe(false);
    expect(presets.list[0].tree).toEqual(workspace.tree);
    expect(presets.list[0].panelControlsById).toEqual(workspace.panelControlsById);
    const starter = settingsStore.read().loudnessProfiles.profiles[0];
    expect(starter.name).toBe("Default");
    expect(parseSelection(presets.list[0].loudnessProfileActive)).toEqual({
      kind: "profile",
      id: starter.id,
    });
  });

  it("does not seed a preset into an installation that has run before", async () => {
    storeExistingWorkspace();
    const { result } = renderHook(() => usePresetLibrary(), { wrapper });
    await act(async () => {});

    expect(result.current.list).toEqual([]);
    expect(presetsStore.read().list ?? []).toEqual([]);
  });

  it("does not seed a new workspace whose library already has presets", async () => {
    const existing = { id: "preset-1", name: "Mix", ...DEFAULT_WORKSPACE_STATE };
    presetsStore.patch({ list: [existing] });
    const { result } = renderHook(() => usePresetLibrary(), { wrapper });
    await act(async () => {});

    expect(result.current.list.map((preset) => preset.name)).toEqual(["Mix"]);
    expect(result.current.activeId).toBeNull();
  });

  it("saves the current scene as a preset and makes it active", async () => {
    storeExistingWorkspace();
    const { result } = renderHook(() => usePresetLibrary(), { wrapper });

    await act(async () => {
      await result.current.save("Mix");
    });

    expect(result.current.list.map((preset) => preset.name)).toEqual(["Mix"]);
    expect(result.current.activeId).toBe(result.current.list[0].id);
    expect(result.current.dirty).toBe(false);
  });

  it("refuses to save while a blocking editor is open and changes nothing", async () => {
    storeExistingWorkspace();
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
