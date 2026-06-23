/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileAnalysisSummary } from "./FileAnalysisSummary.jsx";

const menuProps = {
  fileSessions: [
    { id: "one", fileName: "one.wav", state: "complete", summary: { durationMs: 1000 } },
    { id: "two", fileName: "two.wav", state: "error", error: "Failed" },
  ],
  activeFileId: "one",
  analyzingFileId: null,
};

describe("FileAnalysisSummary", () => {
  it("renders completed file metadata and authoritative delivery metrics", () => {
    render(
      <FileAnalysisSummary
        fileSession={{
          state: "complete",
          fileName: "final.wav",
          metadata: {
            container: "wav",
            selectedTrack: {
              index: 0,
              codec: "pcm",
              sampleRateHz: 48000,
              channels: 2,
            },
          },
          summary: {
            durationMs: 180000,
            sampleRateHz: 48000,
            channels: 2,
            integratedLufs: -16.2,
            lra: 4.1,
            truePeakMaxDbtp: -1.0,
            samplePeakMaxLDb: -2.1,
            samplePeakMaxRDb: -2.3,
            dialogueIntegrated: -Infinity,
          },
        }}
      />
    );

    expect(screen.getByText("final.wav")).toBeTruthy();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("-16.2 LUFS")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
    expect(screen.getByText("-1.0 dBTP")).toBeTruthy();
    expect(screen.getByText("Track 0 · pcm · 48 kHz · 2 ch")).toBeTruthy();
  });

  it("renders an error state", () => {
    render(<FileAnalysisSummary fileSession={{ state: "error", error: "Unsupported codec" }} />);
    expect(screen.getByText("Unsupported codec")).toBeTruthy();
  });

  it("renders the file history menu in the completed banner", () => {
    render(
      <FileAnalysisSummary
        fileSession={{ state: "complete", fileName: "final.wav", summary: {} }}
        {...menuProps}
      />
    );

    expect(screen.getByRole("button", { name: "2 files" })).toBeTruthy();
  });

  it("renders the file history menu in the error banner", () => {
    render(
      <FileAnalysisSummary
        fileSession={{ state: "error", error: "Unsupported codec" }}
        {...menuProps}
      />
    );

    expect(screen.getByRole("button", { name: "2 files" })).toBeTruthy();
  });

  it("warns that scrub history is limited when the session was truncated", () => {
    render(
      <FileAnalysisSummary
        fileSession={{
          state: "complete",
          fileName: "long.wav",
          summary: { durationMs: 3_600_000, sampleRateHz: 48000, channels: 2 },
          historyTruncated: true,
          historyCoveredMs: 300_000,
        }}
      />
    );

    expect(screen.getByText(/Scrub history is limited to the last/)).toBeTruthy();
    expect(screen.getByText(/00:05:00/)).toBeTruthy();
  });

  it("omits the truncation warning for a fully-covered session", () => {
    render(
      <FileAnalysisSummary
        fileSession={{
          state: "complete",
          fileName: "short.wav",
          summary: { durationMs: 5_000, sampleRateHz: 48000, channels: 2 },
        }}
      />
    );

    expect(screen.queryByText(/Scrub history is limited/)).toBeNull();
  });
});
