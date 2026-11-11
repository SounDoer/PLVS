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

  it("derives the live scrub state from elapsed session time", () => {
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
      statusLabel: "00:01:31",
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    });
  });

  it("keeps latest live snapshot time aligned with the live session clock", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 0,
        latestTimestampMs: 14 * 60_000 + 34_000,
        elapsedMs: 25 * 60_000 + 40_000,
      })
    ).toMatchObject({
      statusLabel: "00:25:40",
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    });
  });

  it("keeps live snapshot time frozen after entering snapshot mode", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 0,
        selectedSnapshotTimeMs: 25 * 60_000,
        elapsedMs: 26 * 60_000,
      })
    ).toMatchObject({
      statusLabel: "00:25:00",
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    });
  });

  it("derives live scrub time from elapsed session time without native timestamps", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 8,
        elapsedMs: 99_000,
      }).statusLabel
    ).toBe("00:01:31");
  });

  it("derives the empty file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "empty" },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "No File",
      actionLabel: "OPEN",
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
      statusLabel: "Ready",
      actionLabel: "OPEN",
      actionKind: "chooseFile",
    });
  });

  it("derives the analyzing file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: {
          state: "analyzing",
          fileName: "final_mix.wav",
          progress: 0.42,
          metadata: { durationMs: 5000 },
        },
      })
    ).toMatchObject({
      statusLabel: "42%",
      actionLabel: "CANCEL",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
    });
  });

  it("reflects the active file (not the background analysis) and disables Open", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: {
          state: "complete",
          fileName: "displayed.wav",
          summary: { durationMs: 120_000 },
        },
        analyzingFileSession: {
          state: "analyzing",
          fileName: "background.wav",
          progress: 0.37,
        },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "00:02:00",
      actionLabel: "OPEN",
      chromeState: "ready",
      actionKind: "chooseFile",
      primaryActionDisabled: true,
    });
  });

  it("disables Open for a ready active file while another file analyzes", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "ready", fileName: "queued.wav" },
        analyzingFileSession: {
          state: "analyzing",
          fileName: "background.wav",
          progress: 0.5,
        },
      })
    ).toMatchObject({
      actionLabel: "OPEN",
      actionKind: "chooseFile",
      primaryActionDisabled: true,
    });
  });

  it("keeps selected media time ahead of analyzing progress", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        selectedOffset: 0,
        selectedMediaTimeMs: 84_000,
        fileSession: {
          state: "complete",
          fileName: "displayed.wav",
          summary: { durationMs: 120_000 },
        },
        analyzingFileSession: {
          state: "analyzing",
          fileName: "background.wav",
          progress: 0.37,
        },
      })
    ).toMatchObject({
      statusLabel: "00:01:24",
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    });
  });

  it("derives the completed file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "complete", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "Done",
      actionLabel: "OPEN",
      actionKind: "chooseFile",
    });
  });

  it("shows the file duration on the completed state when known", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: {
          state: "complete",
          fileName: "final_mix.wav",
          summary: { durationMs: 123_000 },
        },
      })
    ).toMatchObject({
      statusLabel: "00:02:03",
      actionLabel: "OPEN",
      actionKind: "chooseFile",
    });
  });

  it("does not present a probe estimate as a measured duration", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: {
          state: "complete",
          fileName: "final_mix.wav",
          metadata: { durationMs: 5_000 },
        },
      }).statusLabel
    ).toBe("Done");
  });

  it.each([
    [{ state: "canceled" }, {}, "Canceled", "OPEN"],
    [{ state: "error" }, {}, "Failed", "RETRY"],
    [{ state: "analyzing" }, {}, "Working…", "CANCEL"],
    [{ state: "empty" }, { fileImportBusy: true }, "Working…", "CANCEL"],
  ])(
    "keeps the File action aligned with its task state (%#)",
    (fileSession, options, statusLabel, actionLabel) => {
      expect(
        deriveSourceTransportState({ sourceMode: "file", fileSession, ...options })
      ).toMatchObject({ statusLabel, actionLabel });
    }
  );

  it("clamps a negative scrub media time is the caller's job; finite values render as a clock", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        selectedOffset: 3,
        selectedMediaTimeMs: 0,
        fileSession: { state: "complete", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "00:00:00",
      actionLabel: "RESULT",
      actionKind: "returnToFileResult",
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
