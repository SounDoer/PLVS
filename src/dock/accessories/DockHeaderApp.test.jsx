/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockHeaderApp } from "./DockHeaderApp.jsx";

const { client } = vi.hoisted(() => ({ client: { payload: null, action: vi.fn() } }));

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockHeaderApp", () => {
  it("asks the main window to dismiss on Escape", () => {
    const { unmount } = render(<DockHeaderApp />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(client.action.mock.calls).toEqual([["dismiss-toolbar"]]);
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
    const modules = screen.getByRole("button", { name: "Edit modules" });
    act(() => modules.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("Edit modules");

    fireEvent.blur(window);

    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
    client.payload = null;
  });
});
