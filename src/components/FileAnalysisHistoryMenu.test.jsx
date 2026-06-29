/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";

const sessions = [
  {
    id: "ready",
    fileName: "ready.wav",
    state: "ready",
  },
  {
    id: "analyzing",
    fileName: "scan.wav",
    state: "analyzing",
    progress: 0.42,
    metadata: {
      container: "wav",
      selectedTrack: { index: 0, codec: "pcm", sampleRateHz: 48000, channels: 2 },
    },
  },
  {
    id: "complete",
    fileName: "final.mov",
    state: "complete",
    metadata: {
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      selectedTrack: { index: 1, codec: "ac3", sampleRateHz: 48000, channels: 6 },
    },
    summary: { durationMs: 120_000, integratedLufs: -23.1, lra: 5.0, truePeakMaxDbtp: -1.0 },
  },
  {
    id: "error",
    fileName: "broken.wav",
    state: "error",
    error: "Unsupported codec",
  },
];

function renderMenu(props = {}) {
  const handlers = {
    onSelectFile: vi.fn(),
    onReanalyzeFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onClearAllFiles: vi.fn(),
    onStopFile: vi.fn(),
  };

  render(
    <FileAnalysisHistoryMenu
      fileSessions={sessions}
      activeFileId="complete"
      analyzingFileId="analyzing"
      {...handlers}
      {...props}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "4 files" }));
  return handlers;
}

describe("FileAnalysisHistoryMenu", () => {
  it("shows a compact trigger count", () => {
    render(
      <FileAnalysisHistoryMenu
        fileSessions={sessions.slice(0, 1)}
        activeFileId="ready"
        analyzingFileId={null}
      />
    );

    expect(screen.getByRole("button", { name: "1 file" })).toBeTruthy();
  });

  it("lists file sessions with status and active/analyzing markers", () => {
    renderMenu();

    expect(screen.getByText("ready.wav")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("scan.wav")).toBeTruthy();
    expect(screen.getAllByText("42%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("WAV - PCM - Stereo")).toBeTruthy();
    expect(screen.getByText("final.mov")).toBeTruthy();
    expect(screen.getByText("00:02:00")).toBeTruthy();
    expect(screen.getByText("-23.1 LUFS - 5.0 LU - -1.0 dBTP")).toBeTruthy();
    expect(screen.getByText("broken.wav")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Unsupported codec")).toBeTruthy();
    expect(screen.getByLabelText("Active file final.mov")).toBeTruthy();
  });

  it("calls select, reanalyze, remove, and clear all callbacks", () => {
    const handlers = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Show file ready.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Reanalyze ready.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove ready.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all file history" }));

    expect(handlers.onSelectFile).toHaveBeenCalledWith("ready");
    expect(handlers.onReanalyzeFile).toHaveBeenCalledWith("ready");
    expect(handlers.onRemoveFile).toHaveBeenCalledWith("ready");
    expect(handlers.onClearAllFiles).toHaveBeenCalledTimes(1);
  });

  it("shows a progress indicator on the trigger while a file analyzes", () => {
    render(
      <FileAnalysisHistoryMenu
        fileSessions={sessions}
        activeFileId="complete"
        analyzingFileId="analyzing"
      />
    );

    // Accessible name stays the plain count; the percentage is decorative.
    expect(screen.getByRole("button", { name: "4 files" })).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("stops the analyzing entry without removing it", () => {
    const handlers = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Stop analyzing scan.wav" }));
    expect(handlers.onStopFile).toHaveBeenCalledWith("analyzing");
    expect(handlers.onRemoveFile).not.toHaveBeenCalled();
  });
});
