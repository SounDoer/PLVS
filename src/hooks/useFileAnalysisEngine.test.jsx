/** @vitest-environment jsdom */
import React, { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { detectHistoryTruncation, useFileAnalysisEngine } from "./useFileAnalysisEngine.js";

vi.mock("../ipc/commands.js", () => ({
  probeFileAnalysis: vi.fn(async () => ({
    path: "C:/mix/final.wav",
    fileName: "final.wav",
    container: "wav",
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
    eventCallbacks.progress = callback;
    return vi.fn();
  }),
  onFileAnalysisCompleted: vi.fn(async (callback) => {
    eventCallbacks.completed = callback;
    return vi.fn();
  }),
  onFileAnalysisError: vi.fn(async (callback) => {
    eventCallbacks.error = callback;
    return vi.fn();
  }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: vi.fn(() => true),
}));

vi.mock("../lib/tauriFrameApply.js", () => ({
  buildTauriFrameApply: () => ({
    applyFrame: vi.fn(),
  }),
}));

import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

function Harness({
  enabled = true,
  path = "C:/mix/final.wav",
  runId = 1,
  sessionId = "session-a",
  intake = { reset: vi.fn(), getLoudnessHistory: () => [] },
  updateFileSession = vi.fn(),
  setAnalyzingFileId = vi.fn(),
  setFileSession,
}) {
  const audioRef = useRef(null);
  const selectedOffsetRef = useRef(-1);
  const frameRef = useRef(0);
  const defaultSampleRateRef = useRef(48000);

  const api = useFileAnalysisEngine({
    filePath: path,
    enabled,
    runId,
    sessionId,
    histMaxSamples: 10,
    visualMaxSamples: 10,
    audioRef,
    frameRef,
    selectedOffsetRef,
    defaultSampleRateRef,
    intake,
    updateFileSession,
    setAnalyzingFileId,
    setFileSession,
    setAudio: vi.fn(),
    setHistoryPathM: vi.fn(),
    setHistoryPathST: vi.fn(),
    setSelectedOffset: vi.fn(),
    setStatus: vi.fn(),
  });

  window.__fileApi = api;
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
  isTauri.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  delete window.__fileApi;
});

describe("useFileAnalysisEngine", () => {
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
      expect.objectContaining({ path: "C:/mix/final.wav", onFrame: expect.any(Function) })
    );
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

  it("completes the targeted session with summary and truncation details", async () => {
    const intake = {
      reset: vi.fn(),
      getLoudnessHistory: () =>
        Array.from({ length: 10 }, (_, i) => ({ timestampMs: 600_000 + i * 100 })),
    };
    const { updateFileSession, setAnalyzingFileId } = renderHarness({
      sessionId: "session-a",
      intake,
    });

    await waitFor(() => expect(eventCallbacks.completed).toEqual(expect.any(Function)));

    act(() => {
      eventCallbacks.completed({
        path: "C:/mix/final.wav",
        decodedFrames: 4096,
        summary: { durationMs: 3_600_000 },
      });
    });

    expect(updateFileSession).toHaveBeenLastCalledWith("session-a", expect.any(Function));
    expect(applySessionUpdater(updateFileSession, { state: "analyzing" })).toMatchObject({
      state: "complete",
      progress: 1,
      decodedFrames: 4096,
      summary: { durationMs: 3_600_000 },
      historyTruncated: true,
      historyCoveredMs: 900,
      analyzedAt: expect.any(Number),
    });
    expect(setAnalyzingFileId).toHaveBeenLastCalledWith(expect.any(Function));
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-a")).toBeNull();
    expect(setAnalyzingFileId.mock.calls.at(-1)[0]("session-b")).toBe("session-b");
  });

  it("marks the targeted session as error and clears the matching analyzing id", async () => {
    const { updateFileSession, setAnalyzingFileId } = renderHarness({ sessionId: "session-a" });

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
  });

  it("stops the active file analysis without mutating a single file session", async () => {
    const setFileSession = vi.fn();
    renderHarness({ setFileSession });

    await waitFor(() => expect(startFileAnalysis).toHaveBeenCalled());

    await act(async () => {
      await window.__fileApi.stop();
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
    isTauri.mockReturnValue(false);
    const updateFileSession = vi.fn();

    renderHarness({ updateFileSession, sessionId: "session-a" });

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
  });
});

function intakeWithLoudness(entries) {
  return { getLoudnessHistory: () => entries };
}

describe("detectHistoryTruncation", () => {
  it("flags truncation when a full ring covers less than the file duration", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ timestampMs: 600_000 + i * 100 }));
    const result = detectHistoryTruncation(intakeWithLoudness(entries), 10, 3_600_000);
    expect(result.historyTruncated).toBe(true);
    expect(result.historyCoveredMs).toBe(900);
  });

  it("does not flag truncation when the ring is not full", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ timestampMs: i * 100 }));
    expect(detectHistoryTruncation(intakeWithLoudness(entries), 10, 3_600_000)).toEqual({
      historyTruncated: false,
      historyCoveredMs: undefined,
    });
  });

  it("does not flag truncation when the retained window covers the whole file", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ timestampMs: i * 100 }));
    // Covered window is 900ms; a 900ms file is fully represented, so no truncation.
    expect(detectHistoryTruncation(intakeWithLoudness(entries), 10, 900)).toEqual({
      historyTruncated: false,
      historyCoveredMs: undefined,
    });
  });
});
