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
  it("keeps status above the action and utilities in order without a duplicate source label", () => {
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
    expect(screen.getByText("100:12:34")).toBeTruthy();
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
  it("adds updates last without replacing permanent controls", () => {
    const props = { edge: "top", toolbarOpen: false, transport: state };
    const { rerender } = render(<DockControlArea {...props} />);
    const permanent = screen.getAllByRole("button");
    rerender(<DockControlArea {...props} update={{ phase: "ready", label: "Update Ready" }} />);
    expect(screen.getAllByRole("button").slice(0, 3)).toEqual(permanent);
    expect(screen.getAllByRole("button").at(-1).getAttribute("aria-label")).toBe("update ready");
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
