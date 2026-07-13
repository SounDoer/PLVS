import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockEditorApp, measureDockEditorContent } from "./DockEditorApp.jsx";

const { action, client } = vi.hoisted(() => ({
  action: vi.fn(),
  client: {
    payload: null,
    action: null,
    pointer: vi.fn(),
  },
}));

const PRESETS_PAYLOAD = {
  view: "presets",
  modules: [],
  controlsByModuleId: {},
  presets: { list: [], activeId: null, dirty: false },
};

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockEditorApp window behavior", () => {
  beforeEach(() => {
    action.mockClear();
    client.payload = PRESETS_PAYLOAD;
    client.action = action;
  });

  it("closes when the accessory window loses focus", async () => {
    render(<DockEditorApp />);

    fireEvent(window, new Event("blur"));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("close-editor", { view: "presets", reason: "blur" })
    );
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

  it("measures intrinsic content instead of an expanded scroll viewport", () => {
    render(<DockEditorApp />);
    const root = screen.getByTestId("dock-editor");
    const shell = root.querySelector("[data-dock-editor-shell]");
    const scroll = root.querySelector("[data-dock-editor-scroll]");
    const content = root.querySelector("[data-dock-editor-content]");
    const header = shell.querySelector("header");
    Object.defineProperties(root, { scrollWidth: { configurable: true, value: 238 } });
    Object.defineProperties(shell, { scrollWidth: { configurable: true, value: 238 } });
    Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 640 } });
    Object.defineProperties(content, {
      scrollWidth: { configurable: true, value: 238 },
      scrollHeight: { configurable: true, value: 129 },
    });
    Object.defineProperties(header, { offsetHeight: { configurable: true, value: 40 } });

    expect(measureDockEditorContent(root)).toEqual({ width: 240, height: 171 });
  });

  it("publishes intrinsic size again when the same editor is reopened", async () => {
    const { rerender } = render(<DockEditorApp />);
    await waitFor(() =>
      expect(action.mock.calls.filter(([type]) => type === "resize-editor")).toHaveLength(1)
    );

    client.payload = { ...PRESETS_PAYLOAD, view: null };
    rerender(<DockEditorApp />);
    client.payload = PRESETS_PAYLOAD;
    rerender(<DockEditorApp />);

    await waitFor(() =>
      expect(action.mock.calls.filter(([type]) => type === "resize-editor")).toHaveLength(2)
    );
    expect(action).toHaveBeenLastCalledWith(
      "resize-editor",
      expect.objectContaining({ view: "presets" })
    );
  });

  it("lets module settings use their intrinsic width", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "module:spectrogram",
      controlsByModuleId: {
        spectrogram: {
          channel: { type: "pair", x: 0, y: 1 },
          minDb: -96,
          maxDb: -12,
          minFreq: 20,
          maxFreq: 20000,
        },
      },
    };

    render(<DockEditorApp />);

    const classes = screen.getByTestId("dock-editor").className.split(/\s+/);
    expect(classes).toContain("w-max");
    expect(classes).not.toContain("w-[400px]");
  });
});
