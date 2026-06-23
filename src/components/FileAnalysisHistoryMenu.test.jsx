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
  },
  {
    id: "complete",
    fileName: "final.wav",
    state: "complete",
    summary: { durationMs: 120_000 },
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
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("final.wav")).toBeTruthy();
    expect(screen.getByText("00:02:00")).toBeTruthy();
    expect(screen.getByText("broken.wav")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByLabelText("Active file final.wav")).toBeTruthy();
    expect(screen.getByText("Analyzing")).toBeTruthy();
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
});
