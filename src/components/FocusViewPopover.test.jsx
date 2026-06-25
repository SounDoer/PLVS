/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";

describe("FocusViewPopoverContent", () => {
  it("renders Views switches", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Always on Top" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-hide Controls" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact Panels" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hide Chrome" })).toBeTruthy();
  });

  it("orders Views switches from window behaviour to content density", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getAllByRole("switch").map((node) => node.id)).toEqual([
      "focus-view-always-on-top",
      "focus-view-compact-panels",
      "focus-view-borderless",
      "focus-view-auto-hide-controls",
    ]);
  });

  it("reflects current switch state", () => {
    render(
      <FocusViewPopoverContent
        focusView={{ autoHideControls: true, compactPanels: false, borderless: false }}
      />
    );

    expect(screen.getByRole("switch", { name: "Always on Top" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(
      screen.getByRole("switch", { name: "Auto-hide Controls" }).getAttribute("data-state")
    ).toBe("checked");
    expect(screen.getByRole("switch", { name: "Compact Panels" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(screen.getByRole("switch", { name: "Hide Chrome" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
  });

  it("routes switch changes to callers", () => {
    const setPinned = vi.fn();
    const setAutoHideControls = vi.fn();
    const setCompactPanels = vi.fn();
    const setBorderless = vi.fn();
    render(
      <FocusViewPopoverContent
        pinned={false}
        setPinned={setPinned}
        focusView={{ autoHideControls: false, compactPanels: false, borderless: false }}
        setAutoHideControls={setAutoHideControls}
        setCompactPanels={setCompactPanels}
        setBorderless={setBorderless}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Always on Top" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-hide Controls" }));
    fireEvent.click(screen.getByRole("switch", { name: "Compact Panels" }));
    fireEvent.click(screen.getByRole("switch", { name: "Hide Chrome" }));

    expect(setPinned).toHaveBeenCalledWith(true);
    expect(setAutoHideControls).toHaveBeenCalledWith(true);
    expect(setCompactPanels).toHaveBeenCalledWith(true);
    expect(setBorderless).toHaveBeenCalledWith(true);
  });
});
