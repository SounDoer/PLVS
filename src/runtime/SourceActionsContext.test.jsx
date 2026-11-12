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
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
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

  it("routes the Start / Stop shortcut through the Live lifecycle action", async () => {
    const { result } = renderHook(
      () => ({ settings: useAppSettings(), runtime: useMeterRuntime() }),
      { wrapper }
    );

    expect(result.current.runtime.liveLifecycle).toBe("stopped");
    await act(async () => {
      await result.current.settings.shortcutActionRef.current("toggleLiveCapture");
    });

    expect(result.current.runtime.liveLifecycle).not.toBe("stopped");
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
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), settings: useAppSettings() }),
      { wrapper }
    );
    expect(result.current.actions.dialogueGating).toBe(true);
    expect(result.current.actions.currentFileAnalysisSettings().dialogue).toEqual({
      enabled: false,
      engine: null,
      engineConfiguration: null,
      multichannelFusion: null,
    });

    act(() => result.current.settings.setFileDialogueDetection(true));
    expect(result.current.actions.currentFileAnalysisSettings().dialogue).toEqual({
      enabled: true,
      engine: result.current.settings.dialogueVadEngine,
      engineConfiguration: "default",
      multichannelFusion: "center-priority-fallback-v1",
    });
  });

  it.each(["analyzing", "complete"])(
    "preserves a %s File entry when the detector changes",
    async (state) => {
      const { result } = renderHook(
        () => ({
          runtime: useMeterRuntime(),
          assembly: useMeterRuntimeAssembly(),
          settings: useAppSettings(),
        }),
        { wrapper }
      );
      act(() => result.current.runtime.switchSource("file"));
      act(() => result.current.runtime.beginFileAnalysis("C:/mix.wav", {}));
      const id = result.current.runtime.activeFileId;
      const summary = { integratedLufs: -23 };
      if (state === "complete") {
        act(() => {
          result.current.assembly.ledger.updateSession(id, (entry) => ({
            ...entry,
            state: "complete",
            summary,
          }));
          result.current.assembly.ledger.setAnalyzingFileId(null);
        });
      }
      const intake = result.current.runtime.activeFileSession.intake;
      await act(async () => result.current.settings.setDialogueVadEngine("silero"));
      expect(result.current.runtime.fileSessions).toHaveLength(1);
      expect(result.current.runtime.activeFileId).toBe(id);
      expect(result.current.runtime.activeFileSession.state).toBe(state);
      expect(result.current.runtime.activeFileSession.intake).toBe(intake);
      if (state === "complete") {
        expect(result.current.runtime.activeFileSession.summary).toBe(summary);
      } else {
        expect(result.current.runtime.analyzingFileId).toBe(id);
      }
    }
  );

  it("still clears Live readings when the detector changes", async () => {
    const { result } = renderHook(
      () => ({ assembly: useMeterRuntimeAssembly(), settings: useAppSettings() }),
      { wrapper }
    );
    act(() => result.current.assembly.display.setAudio((audio) => ({ ...audio, integrated: -23 })));
    await act(async () => result.current.settings.setDialogueVadEngine("silero"));
    expect(result.current.assembly.display.audio.integrated).toBe(-Infinity);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSourceActions())).toThrow(
      "useSourceActions must be used inside SourceActionsProvider"
    );
  });
});
