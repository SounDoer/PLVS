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
    expect(screen.getByText("Drop file to analyze")).toBeTruthy();
  });

  it("calls onDropFile with the dropped path when active", async () => {
    const onDropFile = vi.fn();
    render(<FileDropOverlay active onDropFile={onDropFile} />);
    await emit({ type: "drop", paths: ["C:/mix/final.wav"] });
    expect(onDropFile).toHaveBeenCalledWith("C:/mix/final.wav");
  });
});
