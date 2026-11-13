/** @vitest-environment jsdom */
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import {
  FILE_LOUDNESS_HISTORY_MAX_SAMPLES,
  FILE_VISUAL_HISTORY_MAX_SAMPLES,
  fileHistoryCapacities,
  useFileAnalysisEngine,
} from "./useFileAnalysisEngine.js";

vi.mock("../ipc/commands.js", () => ({
  probeFileAnalysis: vi.fn(async () => ({
    path: "C:/mix/final.wav",
    fileName: "final.wav",
    container: "wav",
    durationMs: 1_000,
    selectedTrack: { index: 0, codec: "pcm", sampleRateHz: 48000, channels: 2 },
  })),
  startFileAnalysis: vi.fn(async ({ onFrame }) => {
    onFrame({ seq: 1, peakDb: [-12, -12], timestampMs: 100 });
    return { marker: "channel" };
  }),
  stopFileAnalysis: vi.fn(async () => {}),
}));

const eventCallbacks = {
  progress: null,
  completed: null,
  error: null,
};

vi.mock("../ipc/events.js", () => ({
  onFileAnalysisProgress: vi.fn(async (callback) => {
    eventCallbacks.progress = (payload) => callback({ runId: "session-a:1", ...payload });
    return vi.fn();
  }),
  onFileAnalysisCompleted: vi.fn(async (callback) => {
    eventCallbacks.completed = (payload) => callback({ runId: "session-a:1", ...payload });
    return vi.fn();
  }),
  onFileAnalysisError: vi.fn(async (callback) => {
    eventCallbacks.error = (payload) => callback({ runId: "session-a:1", ...payload });
    return vi.fn();
  }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: vi.fn(() => true),
}));

vi.mock("../lib/tauriFrameApply.js", () => ({
  buildTauriFrameApply: vi.fn(() => ({
    applyFrame: vi.fn(),
  })),
}));

import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";

/**
 * The harness component below publishes the hook result on `window` so a test can drive it.
 * @typedef {Window & { __fileApi?: any, __selectedOffsetRef?: { current: number }, __latestAudioRef?: { current: any }, __setAudio?: ReturnType<typeof vi.fn> }} HarnessWindow
 */

/**
 * @param {{
 *   enabled?: boolean,
 *   path?: string,
 *   runId?: number,
 *   sessionId?: string,
 *   intake?: any,
 *   updateFileSession?: (...args: any[]) => any,
 *   setAnalyzingFileId?: (...args: any[]) => any,
 *   setFileSession?: (...args: any[]) => any,
 *   raiseNotice?: (...args: any[]) => any,
 *   shouldDriveDisplay?: (...args: any[]) => any,
 *   selectedOffset?: number,
 *   fileAnalysisAcceptanceRef?: { current: any },
 *   settings?: any,
 * }} props
 */
function Harness({
  enabled = true,
  path = "C:/mix/final.wav",
  runId = 1,
  sessionId = "session-a",
  intake = { reset: vi.fn(), getLoudnessHistory: () => [] },
  updateFileSession = vi.fn(),
  setAnalyzingFileId = vi.fn(),
  setFileSession,
  raiseNotice = vi.fn(),
  shouldDriveDisplay = () => true,
  selectedOffset = -1,
  fileAnalysisAcceptanceRef = { current: new Map() },
  settings = { dialogue: { enabled: true, engine: "firered" } },
}) {
  const audioRef = useRef(null);
  const selectedOffsetRef = useRef(selectedOffset);
  const latestAudioRef = useRef({ peakDb: [] });
  const frameRef = useRef(0);
  const setAudio = vi.fn();
  const defaultSampleRateRef = useRef(48000);

  const api = useFileAnalysisEngine(
    /** @type {Parameters<typeof useFileAnalysisEngine>[0]} */ ({
      filePath: path,
      enabled,
      runId,
      sessionId,
      audioRef,
      defaultSampleRateRef,
      intake,
      updateFileSession,
      setAnalyzingFileId,
      setFileSession,
      display: {
        frameRef,
        selectedOffsetRef,
        latestAudioRef,
        setAudio,
        setSelectedOffset: vi.fn(),
        raiseNotice,
      },
      shouldDriveDisplay,
      fileAnalysisAcceptanceRef,
      settings,
    })
  );

  /** @type {HarnessWindow} */ (window).__fileApi = api;
  /** @type {HarnessWindow} */ (window).__selectedOffsetRef = selectedOffsetRef;
  /** @type {HarnessWindow} */ (window).__latestAudioRef = latestAudioRef;
  /** @type {HarnessWindow} */ (window).__setAudio = setAudio;
  return null;
}

function renderHarness(props = {}) {
  const updateFileSession = props.updateFileSession ?? vi.fn();
  const setAnalyzingFileId = props.setAnalyzingFileId ?? vi.fn();

  render(
    <Harness
      {...props}
      updateFileSession={updateFileSession}
      setAnalyzingFileId={setAnalyzingFileId}
    />
  );

  return { updateFileSession, setAnalyzingFileId };
}

function applySessionUpdater(updateFileSession, base = {}) {
  const updater = updateFileSession.mock.calls.at(-1)?.[1];
  expect(updater).toEqual(expect.any(Function));
  return updater(base);
}

beforeEach(() => {
  eventCallbacks.progress = null;
  eventCallbacks.completed = null;
  eventCallbacks.error = null;
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  delete (/** @type {HarnessWindow} */ (window).__fileApi);
  delete (/** @type {HarnessWindow} */ (window).__selectedOffsetRef);
  delete (/** @type {HarnessWindow} */ (window).__latestAudioRef);
  delete (/** @type {HarnessWindow} */ (window).__setAudio);
});

describe("useFileAnalysisEngine", () => {
  it("keeps unknown-duration file history complete instead of silently expiring its front", () => {
    expect(fileHistoryCapacities(undefined)).toEqual({
      loudness: Number.MAX_SAFE_INTEGER,
      visual: Number.MAX_SAFE_INTEGER,
    });
  });

  it("starts analysis by marking the targeted file session as analyzing", async () => {
    const setAnalyzingFileId = vi.fn();
    const updateFileSession = vi.fn();

    await act(async () => {
      renderHarness({ setAnalyzingFileId, updateFileSession, sessionId: "session-a" });
    });

    await waitFor(() => expect(startFileAnalysis).toHaveBeenCalled());

    expect(setAnalyzingFileId).toHaveBeenCalledWith("session-a");
    expect(probeFileAnalysis).toHaveBeenCalledWith("C:/mix/final.wav");
    expect(updateFileSession).toHaveBeenCalledWith("session-a", expect.any(Function));
    expect(applySessionUpdater(updateFileSession, { state: "empty" })).toMatchObject({
      state: "analyzing",
      path: "C:/mix/final.wav",
      fileName: "final.wav",
      progress: 0,
      error: undefined,
      summary: undefined,
    });
    expect(startFileAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "C:/mix/final.wav",
        probe: expect.objectContaining({
          path: "C:/mix/final.wav",
          selectedTrack: expect.objectContaining({ sampleRateHz: 48000, channels: 2 }),
        }),
        onFrame: expect.any(Function),
      })
    );
  });

  it("acknowledges a control run only after the native engine accepts it", async () => {
    const resolve = vi.fn();
    const reject = vi.fn();
    const fileAnalysisAcceptanceRef = {
      current: new Map([["session-a", { resolve, reject }]]),
    };

    renderHarness({ fileAnalysisAcceptanceRef });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(startFileAnalysis).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
    expect(fileAnalysisAcceptanceRef.current.has("session-a")).toBe(false);
  });

  it("keeps the active-session gate separate from snapshot publication", async () => {
    const shouldDriveDisplay = vi.fn(() => true);
    renderHarness({ shouldDriveDisplay });
    await waitFor(() => expect(buildTauriFrameApply).toHaveBeenCalledOnce());

    const options = vi.mocked(buildTauriFrameApply).mock.calls[0][0];
    expect(options.histMaxSamples).toBe(FILE_LOUDNESS_HISTORY_MAX_SAMPLES);
    expect(options.visualMaxSamples).toBe(FILE_VISUAL_HISTORY_MAX_SAMPLES);
    expect(options.shouldDriveDisplay()).toBe(true);
    expect(options.latestAudioRef.current.peakDb).toEqual([]);
    const harness = /** @type {HarnessWindow} */ (window);
    const audio = { peakDb: [-10] };
    harness.__selectedOffsetRef.current = 0;
    options.setAudio(audio);
    expect(harness.__latestAudioRef.current).toBe(audio);
    expect(harness.__setAudio).not.toHaveBeenCalled();

    harness.__selectedOffsetRef.current = -1;
    options.setAudio(audio);
    expect(harness.__setAudio).toHaveBeenCalledWith(audio);
    shouldDriveDisplay.mockReturnValue(false);
    options.setAudio({ peakDb: [-3] });
    expect(harness.__latestAudioRef.current).toBe(audio);
    expect(harness.__setAudio).toHaveBeenCalledTimes(1);
  });

  it("updates progress only for the targeted session id", async () => {
    const { updateFileSession } = renderHarness({ sessionId: "session-a" });

    await waitFor(() => expect(eventCallbacks.progress).toEqual(expect.any(Function)));
    const startCallCount = updateFileSession.mock.calls.length;

    act(() => {
      eventCallbacks.progress({ path: "C:/mix/final.wav", progress: 0.42 });
    });

    expect(updateFileSession).toHaveBeenCalledTimes(startCallCount + 1);
    expect(updateFileSession).toHaveBeenLastCalledWith("session-a", expect.any(Function));
    expect(applySessionUpdater(updateFileSession, { progress: 0.1 })).toMatchObject({
      state: "analyzing",
      progress: 0.42,
    });
  });

  it("ignores stale progress, completion, and error events for another path", async () => {
    const { updateFileSession, setAnalyzingFileId } = renderHarness({ sessionId: "session-a" });

    await waitFor(() => expect(eventCallbacks.error).toEqual(expect.any(Function)));
    const startCallCount = updateFileSession.mock.calls.length;

    act(() => {
      eventCallbacks.progress({ path: "C:/mix/old.wav", progress: 0.5 });
      eventCallbacks.completed({
        path: "C:/mix/old.wav",
        decodedFrames: 128,
        summary: { durationMs: 1000 },
      });
      eventCallbacks.error({ path: "C:/mix/old.wav", message: "stale" });
    });

    expect(updateFileSession).toHaveBeenCalledTimes(startCallCount);
    expect(setAnalyzingFileId).toHaveBeenCalledTimes(1);
  });

  it("completes the targeted session with whole-file history coverage", async () => {
    const intake = { reset: vi.fn(), getLoudnessHistory: () => [] };
    const { updateFileSession, setAnalyzingFileId } = renderHarness({
      sessionId: "session-a",
      intake,
    });

    await waitFor(() => expect(eventCallbacks.completed).toEqual(expect.any(Function)));

    const summary = {
      durationMs: 3_600_000,
      channelPeaks: [
        {
          channelIndex: 0,
          samplePeakMaxDb: -2,
          truePeakMaxDbtp: -1,
          samplePeakMaxLocation: { framePosition: 12, timeSeconds: 12 / 48000 },
          truePeakMaxLocation: { framePosition: 12.375, timeSeconds: 12.375 / 48000 },
        },
      ],
      maximaLocations: {
        samplePeakMax: { channelIndex: 0, framePosition: 12, timeSeconds: 12 / 48000 },
        truePeakMax: null,
        mMaxWindowEnd: null,
        stMaxWindowEnd: null,
      },
    };
    act(() => {
      eventCallbacks.completed({
        path: "C:/mix/final.wav",
        decodedFrames: 4096,
        summary,
      });
    });

    expect(updateFileSession).toHaveBeenLastCalledWith("session-a", expect.any(Function));
    expect(applySessionUpdater(updateFileSession, { state: "analyzing" })).toMatchObject({
      state: "complete",
      progress: 1,
      decodedFrames: 4096,
      summary,
      analyzedAt: expect.any(Number),
    });
    expect(setAnalyzingFileId).toHaveBeenLastCalledWith(expect.any(Function));
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-a")).toBeNull();
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-b")).toBe("session-b");
  });

  it("marks the targeted session as error and clears the matching analyzing id", async () => {
    const raiseNotice = vi.fn();
    const { updateFileSession, setAnalyzingFileId } = renderHarness({
      sessionId: "session-a",
      raiseNotice,
    });

    await waitFor(() => expect(eventCallbacks.error).toEqual(expect.any(Function)));

    act(() => {
      eventCallbacks.error({ path: "C:/mix/final.wav", message: "decode failed" });
    });

    expect(updateFileSession).toHaveBeenLastCalledWith("session-a", expect.any(Function));
    expect(applySessionUpdater(updateFileSession, { state: "analyzing" })).toMatchObject({
      state: "error",
      error: "decode failed",
      analyzedAt: expect.any(Number),
    });
    expect(setAnalyzingFileId).toHaveBeenLastCalledWith(expect.any(Function));
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-a")).toBeNull();
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-b")).toBe("session-b");
    expect(raiseNotice).toHaveBeenCalledWith("error", "Error: decode failed", undefined, {
      requiresAttention: true,
      helpTopic: "file-open-analysis",
    });
  });

  it("stops the active file analysis without mutating a single file session", async () => {
    const setFileSession = vi.fn();
    renderHarness({ setFileSession });

    await waitFor(() => expect(startFileAnalysis).toHaveBeenCalled());

    await act(async () => {
      await /** @type {HarnessWindow} */ (window).__fileApi.stop();
    });

    expect(stopFileAnalysis).toHaveBeenCalled();
    expect(setFileSession).not.toHaveBeenCalled();
  });

  it("does not start when the session id is missing", async () => {
    renderHarness({ sessionId: null });

    await act(async () => {});

    expect(probeFileAnalysis).not.toHaveBeenCalled();
    expect(startFileAnalysis).not.toHaveBeenCalled();
  });

  it("preserves the targeted session entry shape in browser fallback", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const updateFileSession = vi.fn();
    const raiseNotice = vi.fn();

    renderHarness({ updateFileSession, sessionId: "session-a", raiseNotice });

    await waitFor(() =>
      expect(updateFileSession).toHaveBeenCalledWith("session-a", expect.any(Function))
    );

    const intake = { marker: "intake" };
    expect(
      applySessionUpdater(updateFileSession, {
        id: "session-a",
        path: "C:/mix/final.wav",
        fileName: "final.wav",
        intake,
        state: "analyzing",
      })
    ).toEqual({
      id: "session-a",
      path: "C:/mix/final.wav",
      fileName: "final.wav",
      intake,
      state: "empty",
    });
    expect(probeFileAnalysis).not.toHaveBeenCalled();
    expect(startFileAnalysis).not.toHaveBeenCalled();
    expect(raiseNotice).toHaveBeenCalledWith(
      "error",
      "Error: File analysis runs in the desktop app"
    );
  });

  it("does not start after a probe resolves following cancellation", async () => {
    let finishProbe;
    vi.mocked(probeFileAnalysis).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishProbe = resolve;
        })
    );
    renderHarness();
    await act(async () => {
      await /** @type {HarnessWindow} */ (window).__fileApi.stop();
    });
    await act(async () =>
      finishProbe({ path: "C:/mix/final.wav", selectedTrack: { sampleRateHz: 48000, channels: 2 } })
    );
    expect(startFileAnalysis).not.toHaveBeenCalled();
  });

  it("ignores same-path messages from a different attempt", async () => {
    const { updateFileSession } = renderHarness();
    await waitFor(() => expect(startFileAnalysis).toHaveBeenCalled());
    const before = updateFileSession.mock.calls.length;
    act(() => {
      eventCallbacks.progress({ runId: "session-a:0", path: "C:/mix/final.wav", progress: 0.9 });
      eventCallbacks.completed({ runId: "session-a:0", path: "C:/mix/final.wav", summary: {} });
      eventCallbacks.error({ runId: "session-a:0", path: "C:/mix/final.wav", message: "old" });
    });
    expect(updateFileSession).toHaveBeenCalledTimes(before);
  });

  it("waits for the final frame sequence before publishing completion", async () => {
    const { updateFileSession } = renderHarness();
    await waitFor(() => expect(startFileAnalysis).toHaveBeenCalled());
    const onFrame = vi.mocked(startFileAnalysis).mock.calls[0][0].onFrame;
    const before = updateFileSession.mock.calls.length;
    act(() =>
      eventCallbacks.completed({
        path: "C:/mix/final.wav",
        finalSequence: 2,
        decodedFrames: 48000,
        summary: { integratedLufs: -23 },
      })
    );
    expect(updateFileSession).toHaveBeenCalledTimes(before);
    act(() => onFrame({ seq: 2 }));
    expect(applySessionUpdater(updateFileSession).state).toBe("complete");
    const completedCalls = updateFileSession.mock.calls.length;
    act(() =>
      eventCallbacks.completed({ path: "C:/mix/final.wav", finalSequence: 2, summary: {} })
    );
    expect(updateFileSession).toHaveBeenCalledTimes(completedCalls);
  });
});
