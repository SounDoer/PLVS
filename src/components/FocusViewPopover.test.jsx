/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";

describe("FocusViewPopoverContent", () => {
  it("renders Views switches", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Always on top" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-hide controls" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact panels" })).toBeTruthy();
  });

  it("orders Views switches from window behaviour to content density", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getAllByRole("switch").map((node) => node.id)).toEqual([
      "focus-view-always-on-top",
      "focus-view-compact-panels",
      "focus-view-auto-hide-controls",
    ]);
  });

  it("reflects current switch state", () => {
    render(
      <FocusViewPopoverContent focusView={{ autoHideControls: true, compactPanels: false }} />
    );

    expect(screen.getByRole("switch", { name: "Always on top" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(
      screen.getByRole("switch", { name: "Auto-hide controls" }).getAttribute("data-state")
    ).toBe("checked");
    expect(screen.getByRole("switch", { name: "Compact panels" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
  });

  it("routes switch changes to callers", () => {
    const setPinned = vi.fn();
    const setAutoHideControls = vi.fn();
    const setCompactPanels = vi.fn();
    render(
      <FocusViewPopoverContent
        pinned={false}
        setPinned={setPinned}
        focusView={{ autoHideControls: false, compactPanels: false }}
        setAutoHideControls={setAutoHideControls}
        setCompactPanels={setCompactPanels}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Always on top" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-hide controls" }));
    fireEvent.click(screen.getByRole("switch", { name: "Compact panels" }));

    expect(setPinned).toHaveBeenCalledWith(true);
    expect(setAutoHideControls).toHaveBeenCalledWith(true);
    expect(setCompactPanels).toHaveBeenCalledWith(true);
  });
});
