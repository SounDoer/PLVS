/** @vitest-environment jsdom */
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
  it("centers transport and Dock tools as one compact group", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    render(<DockHeader state={STATE} onAction={vi.fn()} onPointer={vi.fn()} />);
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      null,
      "Clear",
      "Loudness Profile",
      "Edit modules",
      "Stop reserving screen space",
      "Dock to top",
      "Restore window",
      "Presets",
    ]);
    expect(screen.getByTestId("dock-header").className).toContain("justify-center");
    expect(screen.getByTestId("dock-header-controls").className).toContain("max-w-full");
  });

  it("emits semantic actions and pointer presence", () => {
    const onAction = vi.fn();
    const onPointer = vi.fn();
    render(<DockHeader state={STATE} onAction={onAction} onPointer={onPointer} />);
    fireEvent.pointerEnter(screen.getByTestId("dock-header"));
    const modulesButton = screen.getByRole("button", { name: "Edit modules" });
    vi.spyOn(modulesButton, "getBoundingClientRect").mockReturnValue({
      left: 320,
      width: 24,
    });
    fireEvent.click(modulesButton);
    fireEvent.pointerLeave(screen.getByTestId("dock-header"));
    expect(onPointer.mock.calls).toEqual([[true], [false]]);
    expect(onAction).toHaveBeenCalledWith("open-editor", { view: "modules", anchorX: 332 });
  });

  it("closes an editor when its active toolbar button is clicked again", () => {
    const onAction = vi.fn();
    render(
      <DockHeader
        state={{ ...STATE, editorView: "modules" }}
        onAction={onAction}
        onPointer={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit modules" }));

    expect(onAction).toHaveBeenCalledWith("close-editor");
  });

  it("opens the requested editor directly when another editor is active", () => {
    const onAction = vi.fn();
    render(
      <DockHeader
        state={{ ...STATE, editorView: "modules" }}
        onAction={onAction}
        onPointer={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Presets" }));

    expect(onAction).toHaveBeenCalledWith("open-editor", { view: "presets", anchorX: 0 });
  });

  it("highlights Presets for a clean active preset, but yields to the open-editor state", () => {
    const { rerender } = render(
      <DockHeader
        state={{ ...STATE, activeCleanPreset: true }}
        onAction={vi.fn()}
        onPointer={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(true);

    rerender(
      <DockHeader
        state={{ ...STATE, activeCleanPreset: true, editorView: "presets" }}
        onAction={vi.fn()}
        onPointer={vi.fn()}
      />
    );
    const button = screen.getByRole("button", { name: "Presets" });
    expect(button.classList.contains("bg-accent")).toBe(true);
    expect(button.classList.contains("text-foreground")).toBe(false);
  });

  it("does not highlight Presets for a dirty or absent active preset", () => {
    render(
      <DockHeader
        state={{ ...STATE, activeCleanPreset: false }}
        onAction={vi.fn()}
        onPointer={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(false);
  });

  it("opens the Loudness Profile editor and highlights it while a profile is active", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <DockHeader state={{ ...STATE, loudnessProfileActive: false }} onAction={onAction} />
    );
    const button = screen.getByRole("button", { name: "Loudness Profile" });
    expect(button.classList.contains("text-foreground")).toBe(false);

    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ left: 100, width: 20 });
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith("open-editor", {
      view: "loudness-profile",
      anchorX: 110,
    });

    rerender(<DockHeader state={{ ...STATE, loudnessProfileActive: true }} onAction={onAction} />);
    expect(
      screen.getByRole("button", { name: "Loudness Profile" }).classList.contains("text-foreground")
    ).toBe(true);
  });

  it("emits a reserve toggle instead of a stale target value", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    const onAction = vi.fn();
    render(<DockHeader state={STATE} onAction={onAction} onPointer={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop reserving screen space" }));

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
        onPointer={vi.fn()}
      />
    );

    const notice = screen.getByText("Could not reserve screen space. Dock remains an overlay.");
    expect(notice.className).toContain("ui-signal-bad");
    expect(notice.title).toBe("");
    fireEvent.mouseEnter(notice);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("ABM_NEW rejected the appbar registration");
    expect(tooltip.className).toContain("whitespace-nowrap");
    expect(tooltip.className).toContain("text-ellipsis");
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
