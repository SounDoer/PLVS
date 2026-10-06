/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { MeterRuntimeProvider, useMeterRuntime } from "./MeterRuntimeContext.jsx";
import { SourceActionsProvider, useSourceActions } from "./SourceActionsContext.jsx";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SourceActionsProvider>{children}</SourceActionsProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("SourceActionsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("binds the settings owner's clear ref to its clear action", () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), settings: useAppSettings() }),
      { wrapper }
    );

    expect(result.current.settings.onClearRef.current).toBe(result.current.actions.clearAll);
  });

  it("bumps both reset epochs when a clear succeeds", async () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), runtime: useMeterRuntime() }),
      { wrapper }
    );
    const before = result.current.actions.vectorscopeResetEpoch;

    act(() => result.current.runtime.startLive());
    await act(async () => {
      await result.current.actions.clearAll();
    });

    expect(result.current.actions.vectorscopeResetEpoch).toBe(before + 1);
    expect(result.current.actions.stereoMapResetEpoch).toBe(before + 1);
  });

  it("describes the dialogue settings a file analysis should run with", () => {
    const { result } = renderHook(() => useSourceActions(), { wrapper });
    const { dialogue } = result.current.currentFileAnalysisSettings();

    expect(dialogue.enabled).toBe(result.current.dialogueGating);
    expect(dialogue.engine === null).toBe(!result.current.dialogueGating);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSourceActions())).toThrow(
      "useSourceActions must be used inside SourceActionsProvider"
    );
  });
});
