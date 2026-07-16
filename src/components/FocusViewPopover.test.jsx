/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";

function mockPlatform(platform) {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
}

describe("FocusViewPopoverContent", () => {
  beforeEach(() => {
    // Glass is macOS-only (see glass_effect.rs); default to Mac so existing assertions
    // exercise the switch, with a dedicated test below for the Windows/other-platform case.
    mockPlatform("MacIntel");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Views switches", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Always on Top" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-hide Controls" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact Panels" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hide Chrome" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Glass" })).toBeTruthy();
  });

  it("orders Views switches from window behaviour to content density", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getAllByRole("switch").map((node) => node.id)).toEqual([
      "focus-view-always-on-top",
      "focus-view-compact-panels",
      "focus-view-borderless",
      "focus-view-auto-hide-controls",
      "focus-view-glass",
    ]);
  });

  it("hides the Glass switch outside macOS", () => {
    mockPlatform("Win32");
    render(<FocusViewPopoverContent />);

    expect(screen.queryByRole("switch", { name: "Glass" })).toBeNull();
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
        glassEnabled={true}
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
    expect(screen.getByRole("switch", { name: "Glass" }).getAttribute("data-state")).toBe(
      "checked"
    );
  });

  it("uses the custom opacity range style", () => {
    render(<FocusViewPopoverContent panelOpacity={42} />);

    const opacityRange = screen.getByRole("slider", { name: "Panel opacity" });

    expect(opacityRange.classList.contains("plvs-range")).toBe(true);
    expect(opacityRange.style.getPropertyValue("--range-pct")).toBe("42%");
  });

  it("routes switch changes to callers", () => {
    const setPinned = vi.fn();
    const setAutoHideControls = vi.fn();
    const setCompactPanels = vi.fn();
    const setBorderless = vi.fn();
    const setGlassEnabled = vi.fn();
    render(
      <FocusViewPopoverContent
        pinned={false}
        setPinned={setPinned}
        focusView={{ autoHideControls: false, compactPanels: false, borderless: false }}
        setAutoHideControls={setAutoHideControls}
        setCompactPanels={setCompactPanels}
        setBorderless={setBorderless}
        glassEnabled={false}
        setGlassEnabled={setGlassEnabled}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Always on Top" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-hide Controls" }));
    fireEvent.click(screen.getByRole("switch", { name: "Compact Panels" }));
    fireEvent.click(screen.getByRole("switch", { name: "Hide Chrome" }));
    fireEvent.click(screen.getByRole("switch", { name: "Glass" }));

    expect(setPinned).toHaveBeenCalledWith(true);
    expect(setAutoHideControls).toHaveBeenCalledWith(true);
    expect(setCompactPanels).toHaveBeenCalledWith(true);
    expect(setBorderless).toHaveBeenCalledWith(true);
    expect(setGlassEnabled).toHaveBeenCalledWith(true);
  });

  describe("Dock control", () => {
    it("renders the current position in a compact select", () => {
      render(<FocusViewPopoverContent showDock dockEdge="top" />);

      expect(screen.getByRole("combobox", { name: "Dock position" }).textContent).toContain("Top");
    });

    it("reports edge choices and maps Off back to the existing null value", () => {
      const onDockChange = vi.fn();
      const { rerender } = render(
        <FocusViewPopoverContent showDock dockEdge={null} onDockChange={onDockChange} />
      );

      fireEvent.keyDown(screen.getByRole("combobox", { name: "Dock position" }), {
        key: "ArrowDown",
      });
      fireEvent.click(screen.getByRole("option", { name: "Top" }));
      expect(onDockChange).toHaveBeenLastCalledWith("top");

      rerender(<FocusViewPopoverContent showDock dockEdge="top" onDockChange={onDockChange} />);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Dock position" }), {
        key: "ArrowDown",
      });
      fireEvent.click(screen.getByRole("option", { name: "Off" }));
      expect(onDockChange).toHaveBeenLastCalledWith(null);
    });

    it("places Dock after the normal view controls", () => {
      mockPlatform("Win32");
      render(<FocusViewPopoverContent showDock />);

      const opacity = screen.getByRole("slider", { name: "Panel opacity" });
      const dock = screen.getByRole("combobox", { name: "Dock position" });
      expect(opacity.compareDocumentPosition(dock)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("is disabled in FILE mode", () => {
      render(
        <FocusViewPopoverContent showDock dockDisabled dockEdge={null} onDockChange={vi.fn()} />
      );
      expect(screen.getByRole("combobox", { name: "Dock position" }).disabled).toBe(true);
    });

    it("is hidden when showDock is false (non-Tauri)", () => {
      render(<FocusViewPopoverContent showDock={false} />);
      expect(screen.queryByText(/^dock$/i)).toBeNull();
    });
  });
});
