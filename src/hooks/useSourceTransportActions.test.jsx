/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_PREFERENCES } from "../uiPreferences.js";
import { useSourceTransportActions } from "./useSourceTransportActions.js";

const mocks = vi.hoisted(() => ({
  pickMediaFile: vi.fn(),
}));

vi.mock("../ipc/fileDialog.js", () => ({
  pickMediaFile: mocks.pickMediaFile,
}));

function renderActions(overrides = {}) {
  const props = {
    sourceMode: "live",
    running: false,
    selectedOffset: -1,
    setSelectedOffset: vi.fn(),
    setHistoryOffsetSec: vi.fn(),
    setHistoryWindowSec: vi.fn(),
    startLive: vi.fn(),
    stopLive: vi.fn(),
    switchSource: vi.fn(),
    clearActiveSource: vi.fn().mockResolvedValue(false),
    beginRuntimeFileAnalysis: vi.fn(),
    reanalyzeFile: vi.fn(),
    selectFile: vi.fn(),
    removeFile: vi.fn().mockResolvedValue(false),
    clearFiles: vi.fn().mockResolvedValue(undefined),
    stopFileAnalysis: vi.fn().mockResolvedValue(undefined),
    activeFileSession: null,
    getFileAnalysisSettings: vi.fn(() => ({ dialogue: { enabled: false, engine: null } })),
    onClearSucceeded: undefined,
    ...overrides,
  };
  return {
    props,
    ...renderHook(() => useSourceTransportActions(props)),
  };
}

describe("useSourceTransportActions", () => {
  beforeEach(() => {
    mocks.pickMediaFile.mockReset();
  });

  it("returns from history snapshot to live before toggling capture", () => {
    const clearSnapshot = vi.fn();
    const { result, props } = renderActions({ selectedOffset: 12, clearSnapshot });

    act(() => {
      result.current.onStartClick();
    });

    expect(clearSnapshot).toHaveBeenCalledOnce();
    expect(props.setSelectedOffset).not.toHaveBeenCalled();
    expect(props.startLive).not.toHaveBeenCalled();
    expect(props.stopLive).not.toHaveBeenCalled();
  });

  it.each(["returnToLive", "returnToFileResult"])(
    "routes %s through the shared snapshot business action",
    async (actionKind) => {
      const clearSnapshot = vi.fn();
      const { result, props } = renderActions({ clearSnapshot });

      await act(async () => {
        await result.current.onSourceTransportAction(actionKind);
      });

      expect(clearSnapshot).toHaveBeenCalledOnce();
      expect(props.setSelectedOffset).not.toHaveBeenCalled();
    }
  );

  it("chooses a file and starts analysis with current settings", async () => {
    mocks.pickMediaFile.mockResolvedValue("C:/audio/test.wav");
    const settings = { dialogue: { enabled: true, engine: "webrtc" } };
    const { result, props } = renderActions({
      getFileAnalysisSettings: vi.fn(() => settings),
    });

    await act(async () => {
      await result.current.onSourceTransportAction("chooseFile");
    });

    expect(props.beginRuntimeFileAnalysis).toHaveBeenCalledWith("C:/audio/test.wav", settings);
  });

  it("resets the history viewport when removing the displayed file", async () => {
    const { result, props } = renderActions({
      removeFile: vi.fn().mockResolvedValue(true),
    });

    await act(async () => {
      await result.current.onRemoveFile("file-1");
    });

    expect(props.setHistoryOffsetSec).toHaveBeenCalledWith(0);
    expect(props.setHistoryWindowSec).toHaveBeenCalledWith(
      UI_PREFERENCES.modules.loudness.history.defaultWindowSec
    );
  });

  it("signals display reset only after a successful Clear", async () => {
    const onClearSucceeded = vi.fn();
    const successful = renderActions({
      clearActiveSource: vi.fn().mockResolvedValue(true),
      onClearSucceeded,
    });
    await act(async () => {
      await successful.result.current.clearAll();
    });
    expect(onClearSucceeded).toHaveBeenCalledOnce();

    const failed = renderActions({
      clearActiveSource: vi.fn().mockResolvedValue(false),
      onClearSucceeded,
    });
    await act(async () => {
      await failed.result.current.clearAll();
    });
    expect(onClearSucceeded).toHaveBeenCalledOnce();
  });
});
