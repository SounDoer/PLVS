/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { FileDropOverlay } from "./FileDropOverlay.jsx";

let dragHandler = null;
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb) => {
      dragHandler = cb;
      return Promise.resolve(unlisten);
    },
  }),
}));

beforeEach(() => {
  dragHandler = null;
  unlisten.mockClear();
});

async function emit(payload) {
  await act(async () => {
    await Promise.resolve();
    dragHandler?.({ payload });
  });
}

describe("FileDropOverlay", () => {
  it("does not subscribe to drops when inactive (Live mode ignores OS drags)", async () => {
    render(<FileDropOverlay active={false} onDropFile={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(dragHandler).toBeNull();
  });

  it("shows the overlay on drag enter when active", async () => {
    render(<FileDropOverlay active onDropFile={vi.fn()} />);
    await emit({ type: "enter", paths: ["C:/mix/final.wav"] });
    expect(screen.getByText("Drop File to Analyze")).toBeTruthy();
    expect(screen.queryByText(/stay local/)).toBeNull();

    await emit({ type: "leave" });
    expect(screen.queryByText("Drop File to Analyze")).toBeNull();
  });

  it("calls onDropFile with the dropped path when active", async () => {
    const onDropFile = vi.fn();
    render(<FileDropOverlay active onDropFile={onDropFile} />);
    await emit({ type: "drop", paths: ["C:/mix/final.wav"] });
    expect(onDropFile).toHaveBeenCalledWith("C:/mix/final.wav");
  });

  it("shows the batch size and forwards all dropped paths in order", async () => {
    const onDropFile = vi.fn();
    const paths = ["C:/mix/one.wav", "C:/mix/two.wav"];
    render(<FileDropOverlay active onDropFile={onDropFile} />);
    await emit({ type: "enter", paths });
    await emit({ type: "over" });
    expect(screen.getByText("Drop 2 Files to Analyze")).toBeTruthy();
    await emit({ type: "drop", paths });
    expect(onDropFile).toHaveBeenCalledWith(paths);
    expect(screen.queryByText("Drop 2 Files to Analyze")).toBeNull();
  });

  it("keeps an in-progress drag subscribed while the import callback changes", async () => {
    const original = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<FileDropOverlay active onDropFile={original} />);
    const paths = ["C:/mix/one.wav", "C:/mix/two.wav"];
    await emit({ type: "enter", paths });
    rerender(<FileDropOverlay active onDropFile={latest} showScrim={false} />);
    expect(unlisten).not.toHaveBeenCalled();
    expect(screen.getByText("Drop 2 Files to Analyze")).toBeTruthy();
    await emit({ type: "drop", paths });
    expect(latest).toHaveBeenCalledWith(paths);
    expect(original).not.toHaveBeenCalled();
  });
});
