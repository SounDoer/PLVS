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
  it("shows a queued retry on the original file row and offers Resume Batch when idle", () => {
    const resumeBatch = vi.fn();
    open({
      fileQueue: {
        active: false,
        canResume: true,
        sessionIds: new Set(["three"]),
        items: [{ id: 4, retryId: "three", fileName: "canceled.wav", state: "queued" }],
        resumeBatch,
      },
    });
    expect(screen.getAllByText("canceled.wav")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Queued" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "retry canceled.wav" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume Batch" }));
    expect(resumeBatch).toHaveBeenCalledOnce();
  });
  it("shows batch state inside Files and keeps export separate from stopping or canceling", () => {
    const fileQueue = {
      active: true,
      sessionIds: new Set(["one", "two", "three"]),
      items: [
        { id: 1, fileName: "pending.wav", state: "queued" },
        { id: 2, fileName: "tracks.mov", state: "track" },
        { id: 3, fileName: "broken.wav", state: "error", error: "Invalid media" },
      ],
      cancelBatch: vi.fn(),
    };
    const onExportStatistics = vi.fn();
    const { onStopFile } = open({ fileQueue, analyzingFileId: "two", onExportStatistics });
    expect(screen.getByText("1 Analyzing · 1 Queued · 1 Awaiting Track Selection")).toBeTruthy();
    expect(screen.getByText("Invalid media")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Queued" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Canceled" })).toBeNull();
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose Track…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export Statistics…" })).toHaveProperty(
      "disabled",
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "stop analysis of second.wav" }));
    expect(onStopFile).toHaveBeenCalledWith("two");
    expect(fileQueue.cancelBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Batch…" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel Batch" })
    );
    expect(fileQueue.cancelBatch).toHaveBeenCalledOnce();
    expect(onExportStatistics).not.toHaveBeenCalled();
  });
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
