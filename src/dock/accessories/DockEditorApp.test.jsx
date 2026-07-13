import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockEditorApp } from "./DockEditorApp.jsx";

const { action } = vi.hoisted(() => ({ action: vi.fn() }));

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => ({
    payload: {
      view: "presets",
      modules: [],
      controlsByModuleId: {},
      presets: { list: [], activeId: null, dirty: false },
    },
    action,
    pointer: vi.fn(),
  }),
}));

describe("DockEditorApp window behavior", () => {
  beforeEach(() => action.mockClear());

  it("closes when the accessory window loses focus", () => {
    render(<DockEditorApp />);

    fireEvent(window, new Event("blur"));

    expect(action).toHaveBeenCalledWith("close-editor");
  });

  it("closes when a transparent viewport remainder is clicked", () => {
    render(<DockEditorApp />);

    fireEvent.pointerDown(document.body);

    expect(action).toHaveBeenCalledWith("close-editor");
  });

  it("does not close on focus loss during an active editor drag", () => {
    render(<DockEditorApp />);
    const editor = screen.getByTestId("dock-editor");

    fireEvent.pointerDown(editor);
    fireEvent(window, new Event("blur"));
    fireEvent.pointerUp(window);

    expect(action).not.toHaveBeenCalledWith("close-editor");
  });
});
