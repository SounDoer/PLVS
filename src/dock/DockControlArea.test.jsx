/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockControlArea } from "./DockControlArea.jsx";

const state = {
  sourceLabel: "Live",
  statusLabel: "100:12:34",
  actionLabel: "STOP",
  actionKind: "stopLive",
  chromeState: "live",
  primaryActionDisabled: false,
};

describe("Dock persistent controls", () => {
  it("keeps action and utilities in order without a status or source label", () => {
    const onTransport = vi.fn();
    const onRestore = vi.fn();
    const onToolbarToggle = vi.fn();
    render(
      <DockControlArea
        edge="bottom"
        toolbarOpen={false}
        transport={state}
        onTransport={onTransport}
        onRestore={onRestore}
        onToolbarToggle={onToolbarToggle}
      />
    );
    expect(screen.queryByText("100:12:34")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "stop",
      "show toolbar",
      "return to normal window",
    ]);
    buttons.forEach((b) => fireEvent.click(b));
    expect(onTransport).toHaveBeenCalledWith("stopLive");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onToolbarToggle).toHaveBeenCalledOnce();
  });
  it("shows updates as a toolbar badge without adding or moving buttons", () => {
    const props = { edge: "bottom", toolbarOpen: false, transport: state };
    const { rerender } = render(<DockControlArea {...props} />);
    const permanent = screen.getAllByRole("button");
    expect(screen.queryByTestId("dock-update-badge")).toBeNull();
    rerender(<DockControlArea {...props} update={{ phase: "error", label: "Update Failed" }} />);
    expect(screen.getAllByRole("button")).toEqual(permanent);
    expect(screen.getByTestId("dock-update-badge").dataset.phase).toBe("error");
    expect(permanent[1].getAttribute("aria-label")).toBe("show toolbar · update failed");
  });
  it("points the toolbar arrow toward where the toolbar opens", () => {
    const { rerender } = render(<DockControlArea edge="bottom" toolbarOpen={false} />);
    const arrow = () => screen.getByRole("button", { name: /toolbar/ }).querySelector("svg");
    expect(arrow().dataset.direction).toBe("up");
    rerender(<DockControlArea edge="bottom" toolbarOpen />);
    expect(arrow().dataset.direction).toBe("down");
    rerender(<DockControlArea edge="top" toolbarOpen={false} />);
    expect(arrow().dataset.direction).toBe("down");
  });
  it("preserves Snapshot and disabled primary action semantics", () => {
    const onTransport = vi.fn();
    const props = { edge: "bottom", toolbarOpen: true, onTransport };
    const snapshot = {
      ...state,
      actionLabel: "LIVE",
      actionKind: "returnToLive",
      chromeState: "snapshot",
    };
    const { rerender } = render(<DockControlArea {...props} transport={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    expect(onTransport).toHaveBeenCalledWith("returnToLive");
    onTransport.mockClear();
    rerender(
      <DockControlArea {...props} transport={{ ...snapshot, primaryActionDisabled: true }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    expect(onTransport).not.toHaveBeenCalled();
  });
});
