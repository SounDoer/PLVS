/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockHeaderApp } from "./DockHeaderApp.jsx";

const { client } = vi.hoisted(() => ({ client: { payload: null, action: vi.fn() } }));

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockHeaderApp", () => {
  it("reports where each editor button is whenever the toolbar is shown", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        const left = { sources: 600, presets: 700 }[this.dataset?.tourTarget] ?? 0;
        return new DOMRect(left, 0, left ? 24 : 0, 24);
      });
    client.action.mockClear();
    client.payload = { visible: true, presentationId: 3 };

    const { unmount } = render(<DockHeaderApp />);

    expect(client.action).toHaveBeenCalledWith("header-ready", {
      presentationId: 3,
      anchors: { sources: 612, presets: 712 },
    });
    unmount();
    rect.mockRestore();
    client.payload = null;
    client.action.mockClear();
  });

  it("asks the main window to dismiss on Escape", () => {
    const { unmount } = render(<DockHeaderApp />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape", repeat: true });
    fireEvent.keyDown(window, { key: "Enter" });
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(client.action.mock.calls).toEqual([["dismiss-toolbar"]]);
  });

  it("acknowledges committed content and retains it while the native window hides", () => {
    const snapshot = {
      chromeState: "snapshot",
      sourceLabel: "LIVE",
      statusLabel: "00:12",
      actionLabel: "LIVE",
      actionKind: "returnToLive",
      primaryActionDisabled: false,
    };
    client.action.mockClear();
    client.payload = {
      visible: true,
      presentationId: 7,
      sourceTransportState: snapshot,
      notice: { kind: "error", text: "Existing notice" },
    };
    const { rerender, container } = render(<DockHeaderApp />);
    expect(client.action).toHaveBeenCalledWith("header-ready", { presentationId: 7, anchors: {} });
    const before = container.innerHTML;
    client.payload = {
      visible: false,
      presentationId: 8,
      notice: { kind: "error", text: "New notice" },
      sourceTransportState: {
        ...snapshot,
        chromeState: "ready",
        actionLabel: "START",
        actionKind: "start",
      },
    };
    rerender(<DockHeaderApp />);
    expect(container.innerHTML).toBe(before);
    expect(client.action).not.toHaveBeenCalledWith(
      "header-ready",
      expect.objectContaining({ presentationId: 8 })
    );
    client.payload = { ...client.payload, visible: true, presentationId: 9 };
    rerender(<DockHeaderApp />);
    expect(container.textContent).toContain("New notice");
    expect(client.action).toHaveBeenCalledWith("header-ready", { presentationId: 9, anchors: {} });
    client.payload = null;
  });

  it("drops keyboard focus when its window loses focus, so no focus tip returns with it", () => {
    client.payload = {
      sourceTransportState: {
        chromeState: "ready",
        sourceLabel: "LIVE",
        statusLabel: "00:00",
        actionLabel: "START",
        actionKind: "start",
        primaryActionDisabled: false,
      },
      clearDisabled: false,
      notice: null,
      edge: "bottom",
      reserveSpace: false,
    };
    render(<DockHeaderApp />);
    const modules = screen.getByRole("button", { name: "Panels" });
    act(() => modules.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("Panels");

    fireEvent.blur(window);

    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
    client.payload = null;
  });
});
