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
  it("opens current status details in the native accessory instead of clipping a popover into the toolbar", () => {
    const onAction = vi.fn();
    render(
      <DockHeader
        state={{
          ...STATE,
          statusItems: [
            {
              id: "channel-layout",
              kind: "warning",
              text: "Channel Layout Unknown",
              details: "Loudness uses channels 1–2 only.",
            },
            { id: "update", kind: "update", text: "Update Available", details: "Update Available" },
          ],
        }}
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    expect(onAction).toHaveBeenCalledWith("open-editor", { view: "status", anchorX: 0 });
    expect(screen.queryByTestId("dock-header-update")).toBeNull();
  });
  it("keeps the full Live transport beside the context and existing tools", () => {
    render(<DockHeader state={STATE} onAction={vi.fn()} />);
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText("00:00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Source:/i })).toBeNull();
    expect(screen.getByRole("button", { name: "START" }).dataset.uiTarget).toBe(
      "dock-toolbar:transport"
    );
    const actions = screen.getByTestId("dock-header-actions");
    expect(
      Array.from(actions.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label")
      )
    ).toEqual(["Clear", "Sources", "Loudness Profile", "Panels", "Views", "Presets", "Settings"]);
  });

  it("shows read-only footer names with a themed tip only when clipped and omits absent names", () => {
    const { rerender } = render(
      <DockHeader
        state={{
          ...STATE,
          footer: {
            sourceLabel: "Speakers",
            loudnessProfileName: "EBU R128",
            activePresetName: "Monitoring *",
          },
        }}
        onAction={vi.fn()}
      />
    );
    const context = screen.getByTestId("dock-header-context");
    expect(context.textContent).toBe("SourceSpeakersLoudnessEBU R128PresetMonitoring *");
    expect(context.querySelector("[title]")).toBeNull();

    const value = screen.getByText("EBU R128");
    fireEvent.mouseEnter(value);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseLeave(value);
    Object.defineProperty(value, "scrollWidth", { configurable: true, value: 120 });
    Object.defineProperty(value, "clientWidth", { configurable: true, value: 40 });
    fireEvent.mouseEnter(value);
    expect(screen.getByRole("tooltip").textContent).toBe("Loudness: EBU R128");
    expect(screen.getByTestId("dock-header-context").querySelector("button")).toBeNull();
    rerender(
      <DockHeader
        state={{ ...STATE, footer: { sourceLabel: "Not connected" } }}
        onAction={vi.fn()}
      />
    );
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByText("Loudness")).toBeNull();
    expect(screen.queryByText("Preset")).toBeNull();
  });

  it("names the update state in words just before the tools and opens details", () => {
    const onAction = vi.fn();
    render(
      <DockHeader
        state={{
          ...STATE,
          update: { phase: "ready", label: "Update Ready", text: "Update Ready · v0.22.0" },
        }}
        onAction={onAction}
      />
    );
    const entry = screen.getByTestId("dock-header-update");
    expect(entry.textContent).toBe("Update Ready · v0.22.0");
    expect(entry.nextElementSibling).toBe(screen.getByTestId("dock-header-actions"));
    fireEvent.click(entry);
    expect(onAction).toHaveBeenCalledWith("open-update");
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
    const modulesButton = screen.getByRole("button", { name: "Panels" });
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

    fireEvent.click(screen.getByRole("button", { name: "Panels" }));

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
    ["returnToLive", "LIVE"],
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

    fireEvent.click(screen.getByRole("button", { name: actionLabel }));
    expect(onAction).toHaveBeenCalledWith("source-primary", { actionKind });
  });
});

it("refuses the toolbar transport action while disabled", () => {
  const onAction = vi.fn();
  render(
    <DockHeader
      state={{
        ...STATE,
        sourceTransportState: { ...STATE.sourceTransportState, primaryActionDisabled: true },
      }}
      onAction={onAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "START" }));
  expect(onAction).not.toHaveBeenCalled();
});
