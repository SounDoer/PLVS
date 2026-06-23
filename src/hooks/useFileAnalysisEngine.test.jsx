/** @vitest-environment jsdom */
import React, { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
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

vi.mock("../ipc/events.js", () => ({
  onFileAnalysisProgress: vi.fn(async () => vi.fn()),
  onFileAnalysisCompleted: vi.fn(async () => vi.fn()),
  onFileAnalysisError: vi.fn(async () => vi.fn()),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

vi.mock("../lib/tauriFrameApply.js", () => ({
  buildTauriFrameApply: () => ({
    applyFrame: vi.fn(),
  }),
}));

import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";

function Harness({ path }) {
  const [fileSession, setFileSession] = useState({ state: "empty" });
  const audioRef = useRef(null);
  const selectedOffsetRef = useRef(-1);
  const frameRef = useRef(0);
  const defaultSampleRateRef = useRef(48000);

  const api = useFileAnalysisEngine({
    filePath: path,
    enabled: Boolean(path),
    histMaxSamples: 10,
    visualMaxSamples: 10,
    audioRef,
    frameRef,
    selectedOffsetRef,
    defaultSampleRateRef,
    intake: { reset: vi.fn() },
    setFileSession,
    setAudio: vi.fn(),
    setHistoryPathM: vi.fn(),
    setHistoryPathST: vi.fn(),
    setSelectedOffset: vi.fn(),
    setStatus: vi.fn(),
  });

  window.__fileSession = fileSession;
  window.__fileApi = api;
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  delete window.__fileSession;
  delete window.__fileApi;
});

describe("useFileAnalysisEngine", () => {
  it("probes and starts a file analysis session when enabled", async () => {
    await act(async () => {
      render(<Harness path="C:/mix/final.wav" />);
    });

    expect(probeFileAnalysis).toHaveBeenCalledWith("C:/mix/final.wav");
    expect(startFileAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ path: "C:/mix/final.wav", onFrame: expect.any(Function) })
    );
    expect(window.__fileSession).toMatchObject({
      state: "analyzing",
      fileName: "final.wav",
    });
  });

  it("stops the active file analysis session", async () => {
    await act(async () => {
      render(<Harness path="C:/mix/final.wav" />);
    });

    await act(async () => {
      await window.__fileApi.stop();
    });

    expect(stopFileAnalysis).toHaveBeenCalled();
    expect(window.__fileSession).toMatchObject({ state: "ready" });
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
