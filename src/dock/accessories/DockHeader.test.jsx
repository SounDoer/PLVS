/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockViews } from "../editors/DockViews.jsx";
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
  it("keeps the settings tools without a duplicate transport or central spacer", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    render(<DockHeader state={STATE} onAction={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Clear",
      "Device",
      "Loudness Profile",
      "Edit modules",
      "Views",
      "Presets",
    ]);
    const actions = screen.getByTestId("dock-header-actions");
    expect(buttons.every((button) => actions.contains(button))).toBe(true);
    const [trailing] = screen.getByTestId("dock-header").children;
    expect(screen.getByTestId("dock-header").children).toHaveLength(1);
    expect(trailing).toBe(screen.getByTestId("dock-header-trailing"));
    expect(actions.parentElement).toBe(trailing);
  });

  it("keeps an error notice beside the transport, outside the actions group", () => {
    render(
      <DockHeader
        state={{ ...STATE, notice: { kind: "error", text: "Capture failed" } }}
        onAction={vi.fn()}
      />
    );
    const notice = screen.getByText("Capture failed");
    expect(screen.getByTestId("dock-header-actions").contains(notice)).toBe(false);
  });

  it("emits semantic actions and ignores pointer presence", () => {
    const onAction = vi.fn();
    render(<DockHeader state={STATE} onAction={onAction} />);
    fireEvent.pointerEnter(screen.getByTestId("dock-header"));
    const modulesButton = screen.getByRole("button", { name: "Edit modules" });
    vi.spyOn(modulesButton, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof modulesButton.getBoundingClientRect>} */ ({
        left: 320,
        width: 24,
      })
    );
    fireEvent.click(modulesButton);
    fireEvent.pointerLeave(screen.getByTestId("dock-header"));
    expect(onAction.mock.calls).toEqual([["open-editor", { view: "modules", anchorX: 332 }]]);
  });

  it("closes an editor when its active toolbar button is clicked again", () => {
    const onAction = vi.fn();
    render(<DockHeader state={{ ...STATE, editorView: "modules" }} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit modules" }));

    expect(onAction).toHaveBeenCalledWith("close-editor");
  });

  it("opens the requested editor directly when another editor is active", () => {
    const onAction = vi.fn();
    render(<DockHeader state={{ ...STATE, editorView: "modules" }} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Presets" }));

    expect(onAction).toHaveBeenCalledWith("open-editor", { view: "presets", anchorX: 0 });
  });

  it("opens the Loudness Profile editor without highlighting active configuration", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <DockHeader state={{ ...STATE, loudnessProfileActive: false }} onAction={onAction} />
    );
    const button = screen.getByRole("button", { name: "Loudness Profile" });

    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof button.getBoundingClientRect>} */ ({ left: 100, width: 20 })
    );
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith("open-editor", {
      view: "loudness-profile",
      anchorX: 110,
    });

    rerender(<DockHeader state={{ ...STATE, loudnessProfileActive: true }} onAction={onAction} />);
  });

  it("emits a reserve toggle instead of a stale target value", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    const onAction = vi.fn();
    render(<DockViews state={STATE} onAction={onAction} />);

    fireEvent.click(screen.getByRole("switch", { name: "Reserve Space" }));

    expect(onAction).toHaveBeenCalledWith("toggle-reserve-space");
  });

  it("offers the opt-in reserve action on macOS", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    const onAction = vi.fn();
    render(<DockViews state={{ ...STATE, reserveSpace: false }} onAction={onAction} />);
    fireEvent.click(screen.getByRole("switch", { name: "Reserve Space" }));
    expect(onAction).toHaveBeenCalledWith("toggle-reserve-space");
  });

  it("renders errors like the normal header and exposes technical details as a tooltip", () => {
    render(
      <DockHeader
        state={{
          ...STATE,
          notice: {
            kind: "error",
            text: "Could not reserve screen space. Dock remains an overlay.",
            details: "ABM_NEW rejected the appbar registration",
          },
        }}
        onAction={vi.fn()}
      />
    );

    const notice = screen.getByText("Could not reserve screen space. Dock remains an overlay.");

    expect(notice.title).toBe("");
    fireEvent.mouseEnter(notice);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("ABM_NEW rejected the appbar registration");
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
      />
    );

    expect(screen.queryByRole("button", { name: actionLabel })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});
