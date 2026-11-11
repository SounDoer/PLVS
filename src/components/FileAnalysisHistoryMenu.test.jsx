/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";

const files = [
  { id: "one", fileName: "final.wav", state: "complete", summary: { durationMs: 5000 } },
  {
    id: "two",
    fileName: "second.wav",
    state: "analyzing",
    progress: 0.42,
    metadata: { durationMs: 10000 },
  },
  { id: "three", fileName: "canceled.wav", state: "canceled" },
];

function open(props = {}) {
  const handlers = {
    onSelectFile: vi.fn(),
    onReanalyzeFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onClearAllFiles: vi.fn(),
    onStopFile: vi.fn(),
    onExportReport: vi.fn(),
    onCopyReport: vi.fn(),
  };
  render(
    <FileAnalysisHistoryMenu fileSessions={files} activeFileId="one" {...handlers} {...props} />
  );
  fireEvent.click(screen.getByRole("button", { name: "files" }));
  return handlers;
}

describe("File menu", () => {
  it("clears the list only after confirmation and returns to the list on cancel", () => {
    const { onClearAllFiles } = open();
    fireEvent.click(screen.getByRole("button", { name: "Clear All Files…" }));
    const dialog = () => screen.getByRole("alertdialog", { name: "Clear All Files?" });
    expect(onClearAllFiles).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(onClearAllFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear All Files…" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Clear All Files" }));
    expect(onClearAllFiles).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Clear All Files…" })).toBeNull();
  });

  it("leaves navigation and target-specific cancellation available during background work", () => {
    const handlers = open({ analyzingFileId: "two" });
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "reanalyze final.wav" })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "analyze canceled.wav" })).toHaveProperty(
      "disabled",
      true
    );
    fireEvent.click(screen.getByRole("button", { name: "cancel analysis of second.wav" }));
    expect(handlers.onStopFile).toHaveBeenCalledWith("two");
    fireEvent.click(screen.getByRole("button", { name: "show file canceled.wav" }));
    expect(handlers.onSelectFile).toHaveBeenCalledWith("three");
  });

  it("exports a row's successful result without selecting it", () => {
    const handlers = open({ activeFileId: "three" });
    fireEvent.click(screen.getByRole("button", { name: "export report for final.wav" }));
    fireEvent.click(screen.getByRole("button", { name: "Export Markdown…" }));
    expect(handlers.onExportReport).toHaveBeenCalledWith("markdown", files[0]);
    expect(handlers.onSelectFile).not.toHaveBeenCalled();
  });

  it("distinguishes analysis from reanalysis and targets the chosen row", () => {
    const handlers = open();
    fireEvent.click(screen.getByRole("button", { name: "reanalyze final.wav" }));
    expect(handlers.onReanalyzeFile).toHaveBeenCalledWith("one");
    fireEvent.click(screen.getByRole("button", { name: "analyze canceled.wav" }));
    expect(handlers.onReanalyzeFile).toHaveBeenCalledWith("three");
  });
});
