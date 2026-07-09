/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileAnalysisSummary } from "./FileAnalysisSummary.jsx";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "FileAnalysisSummary.jsx"), "utf8");

const menuProps = {
  fileSessions: [
    { id: "one", fileName: "one.wav", state: "complete", summary: { durationMs: 1000 } },
    { id: "two", fileName: "two.wav", state: "error", error: "Failed" },
  ],
  activeFileId: "one",
  analyzingFileId: null,
};

describe("FileAnalysisSummary", () => {
  it("routes the file-mode summary shell through panel opacity", () => {
    expect(source).toContain("var(--card)_var(--panel-opacity-header)");
    expect(source).toContain("var(--border)_var(--panel-opacity-header)");
    expect(source).not.toContain("border-border bg-card/55");
  });

  it("routes actionable file summary surfaces through panel opacity", () => {
    expect(source).toContain(
      "color-mix(in_srgb,var(--background)_35%,transparent)_var(--panel-opacity-header)"
    );
    expect(source).toContain(
      "color-mix(in_srgb,var(--muted)_55%,transparent)_var(--panel-opacity-header)"
    );
    expect(source).not.toContain("bg-background/35");
  });

  it("renders delivery metrics as text pairs rather than framed chips", () => {
    expect(source).toContain("function MetricPair");
    expect(source).toContain("items-baseline gap-x-4 gap-y-1");
    expect(source).not.toContain("function MetricChip");
  });

  it("renders completed file metadata and authoritative delivery metrics", () => {
    const onExportReport = vi.fn();
    render(
      <FileAnalysisSummary
        onExportReport={onExportReport}
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
              language: "eng",
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
    expect(screen.getByText("LRA")).toBeTruthy();
    expect(screen.getByText("4.1 LU")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
    expect(screen.getByText("-1.0 dBTP")).toBeTruthy();
    expect(screen.queryByText("Sample Peak Max")).toBeNull();
    expect(
      screen.getByText("WAV - Audio track 0 - English - PCM - 48 kHz - Stereo - 00:03:00")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExportReport).toHaveBeenCalledTimes(1);
  });

  it("renders an error session through the normal non-complete summary shell", () => {
    render(
      <FileAnalysisSummary
        fileSession={{ state: "error", fileName: "clip.mov", error: "Unsupported codec" }}
      />
    );

    expect(screen.getByText("clip.mov")).toBeTruthy();
    expect(screen.queryByText("File analysis error")).toBeNull();
    expect(screen.queryByText("Could not analyze clip.mov")).toBeNull();
    expect(screen.queryByText("Unsupported codec")).toBeNull();
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

  it("renders the file history menu for an error session", () => {
    render(
      <FileAnalysisSummary
        fileSession={{ state: "error", error: "Unsupported codec" }}
        {...menuProps}
      />
    );

    expect(screen.getByRole("button", { name: "2 files" })).toBeTruthy();
  });

  it("renders a lightweight analyzing banner with selectable history entries", () => {
    const onSelectFile = vi.fn();
    render(
      <FileAnalysisSummary
        fileSession={{
          id: "analyzing",
          state: "analyzing",
          fileName: "current.wav",
          progress: 0.25,
        }}
        fileSessions={[
          { id: "analyzing", fileName: "current.wav", state: "analyzing", progress: 0.25 },
          {
            id: "complete",
            fileName: "done.wav",
            state: "complete",
            summary: { durationMs: 10_000 },
          },
        ]}
        activeFileId="analyzing"
        analyzingFileId="analyzing"
        onSelectFile={onSelectFile}
      />
    );

    expect(screen.getByText("current.wav")).toBeTruthy();
    expect(screen.queryByText("Integrated")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2 files" }));
    fireEvent.click(screen.getByRole("button", { name: "Show file done.wav" }));

    expect(onSelectFile).toHaveBeenCalledWith("complete");
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
