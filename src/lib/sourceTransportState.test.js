import { describe, expect, it } from "vitest";
import { deriveSourceTransportState } from "./sourceTransportState.js";

describe("deriveSourceTransportState", () => {
  it("derives the live ready state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: false,
        selectedOffset: -1,
        elapsedMs: 0,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "Ready",
      actionLabel: "START",
      chromeState: "ready",
      actionKind: "startLive",
    });
  });

  it("derives the live running state from elapsed session time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: -1,
        elapsedMs: 12_000,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "00:00:12",
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopLive",
    });
  });

  it("derives the live scrub state from selected history time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 8,
        latestTimestampMs: 20_000,
        elapsedMs: 99_000,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "00:00:12",
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    });
  });

  it("falls back to selected offset when no live timestamp exists", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 8,
        elapsedMs: 99_000,
      }).statusLabel
    ).toBe("00:00:08");
  });

  it("derives the empty file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "empty" },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "No file",
      actionLabel: "ANALYZE",
      chromeState: "ready",
      actionKind: "chooseFile",
    });
  });

  it("derives the selected file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "ready", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav",
      actionLabel: "ANALYZE",
      actionKind: "analyzeFile",
    });
  });

  it("derives the analyzing file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "analyzing", fileName: "final_mix.wav", progress: 0.42 },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav 42%",
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
    });
  });

  it("derives the completed file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "complete", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav Done",
      actionLabel: "REANALYZE",
      actionKind: "reanalyzeFile",
    });
  });

  it("derives the file scrub state from media time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        selectedOffset: 0,
        selectedMediaTimeMs: 84_000,
        fileSession: {
          state: "complete",
          fileName: "final_mix.wav",
        },
      })
    ).toMatchObject({
      statusLabel: "00:01:24",
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    });
  });
});
