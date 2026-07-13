import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockHeader } from "./DockHeader.jsx";

const STATE = {
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
  reserveSpace: true,
};

describe("DockHeader", () => {
  it("keeps transport left and the Dock tools in their established order", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    render(<DockHeader state={STATE} onAction={vi.fn()} onPointer={vi.fn()} />);
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      null,
      "Clear",
      "Edit modules",
      "Presets",
      "Stop reserving screen space",
      "Dock to top",
      "Restore window",
    ]);
  });

  it("emits semantic actions and pointer presence", () => {
    const onAction = vi.fn();
    const onPointer = vi.fn();
    render(<DockHeader state={STATE} onAction={onAction} onPointer={onPointer} />);
    fireEvent.pointerEnter(screen.getByTestId("dock-header"));
    fireEvent.click(screen.getByRole("button", { name: "Edit modules" }));
    fireEvent.pointerLeave(screen.getByTestId("dock-header"));
    expect(onPointer.mock.calls).toEqual([[true], [false]]);
    expect(onAction).toHaveBeenCalledWith("open-editor", { view: "modules" });
  });

  it.each([
    ["startLive", "START"],
    ["stopLive", "STOP"],
  ])("forwards the %s transport action to main", (actionKind, actionLabel) => {
    const onAction = vi.fn();
    render(
      <DockHeader
        state={{
          ...STATE,
          sourceTransportState: {
            ...STATE.sourceTransportState,
            actionKind,
            actionLabel,
          },
        }}
        onAction={onAction}
        onPointer={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: actionLabel }));

    expect(onAction).toHaveBeenCalledWith("source-primary", { actionKind });
  });
});
