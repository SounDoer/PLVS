/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { pickMediaFile } from "../ipc/fileDialog.js";

vi.mock("../ipc/fileDialog.js", async (original) => ({
  ...(await original()),
  pickMediaFile: vi.fn(),
}));

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

  it("clears the Live measurement after a History Length change", async () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), settings: useAppSettings() }),
      { wrapper }
    );
    const before = result.current.actions.vectorscopeResetEpoch;
    await act(() => result.current.actions.changeHistoryRetention(7200));
    expect(result.current.settings.historyRetentionSec).toBe(7200);
    expect(result.current.actions.vectorscopeResetEpoch).toBe(before + 1);
  });

  it("routes the Start / Stop shortcut through the Live lifecycle action", async () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), runtime: useMeterRuntime() }),
      { wrapper }
    );

    expect(result.current.runtime.liveLifecycle).toBe("stopped");
    await act(async () => {
      await result.current.actions.dispatchShortcut("toggleLiveCapture");
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

  it("preserves File when a delayed History Length change belongs to an earlier Live source", async () => {
    const { result } = renderHook(
      () => ({
        actions: useSourceActions(),
        runtime: useMeterRuntime(),
        settings: useAppSettings(),
      }),
      { wrapper }
    );
    const target = result.current.runtime.liveClearTarget();
    act(() => {
      result.current.runtime.switchSource("file");
      result.current.runtime.beginFileAnalysis("/tmp/mix.wav", {});
    });
    const id = result.current.runtime.activeFileId;
    const epoch = result.current.actions.vectorscopeResetEpoch;
    await act(async () => {
      await expect(
        result.current.actions.changeHistoryRetention(7200, { target, strict: true })
      ).rejects.toThrow("source changed");
    });
    expect(result.current.settings.historyRetentionSec).toBe(7200);
    expect(result.current.runtime.activeFileId).toBe(id);
    expect(result.current.runtime.fileSessions).toHaveLength(1);
    expect(result.current.actions.vectorscopeResetEpoch).toBe(epoch);
  });

  it.each([false, true])(
    "ignores a picker opened before leaving File (returned to File: %s)",
    async (returnsToFile) => {
      let finishPicker;
      vi.mocked(pickMediaFile).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPicker = resolve;
          })
      );
      const { result } = renderHook(
        () => ({ actions: useSourceActions(), runtime: useMeterRuntime() }),
        { wrapper }
      );
      act(() => result.current.runtime.switchSource("file"));
      let picking;
      act(() => {
        picking = result.current.actions.openFile();
      });
      act(() => result.current.runtime.switchSource("live"));
      if (returnsToFile) act(() => result.current.runtime.switchSource("file"));

      await act(async () => {
        finishPicker("/tmp/late.wav");
        await picking;
      });

      expect(result.current.runtime.fileSessions).toEqual([]);
      expect(result.current.runtime.fileTaskBusy).toBe(false);
    }
  );

  it("keeps the queue and entries when Clear All cannot stop analysis, then clears both on retry", async () => {
    const { result } = renderHook(
      () => ({
        actions: useSourceActions(),
        runtime: useMeterRuntime(),
        assembly: useMeterRuntimeAssembly(),
      }),
      { wrapper }
    );
    act(() => {
      result.current.runtime.switchSource("file");
      result.current.runtime.beginFileAnalysis("/tmp/current.wav", {});
    });
    act(() => result.current.actions.fileQueue.enqueue(["/tmp/next.wav"]));
    const queueBefore = result.current.actions.fileQueue.snapshot.items;
    expect(queueBefore).toHaveLength(1);
    result.current.assembly.stopFileAnalysisRef.current = vi
      .fn()
      .mockRejectedValueOnce(new Error("stop refused"))
      .mockResolvedValueOnce(true);

    await act(async () => {
      await expect(result.current.actions.onClearAllFiles()).resolves.toBe(false);
    });
    expect(result.current.runtime.fileSessions).toHaveLength(1);
    expect(result.current.actions.fileQueue.snapshot.items).toEqual(queueBefore);

    await act(async () => {
      await expect(result.current.actions.clearFileCollection()).resolves.toBeUndefined();
    });
    expect(result.current.runtime.fileSessions).toEqual([]);
    expect(result.current.actions.fileQueue.snapshot.items).toEqual([]);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSourceActions())).toThrow(
      "useSourceActions must be used inside SourceActionsProvider"
    );
  });
});
