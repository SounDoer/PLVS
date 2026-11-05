/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockViews } from "./DockViews.jsx";

describe("Dock Views", () => {
  it("puts where the strip sits before how it looks", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    render(<DockViews state={{ edge: "bottom" }} onAction={vi.fn()} />);
    const controls = [...document.querySelectorAll("[id^='dock-'], [aria-label='Dock position']")];
    expect(controls.map((control) => control.id || control.getAttribute("aria-label"))).toEqual([
      "Dock position",
      "dock-reserve-space",
      "dock-above-full-screen",
      "dock-hide-axes-labels",
      "dock-surface-opacity",
    ]);
  });

  it("offers annotations without inventing a panel header control", () => {
    const onAction = vi.fn();
    render(<DockViews state={{ edge: "bottom", hideAxesAndLabels: true }} onAction={onAction} />);
    expect(screen.queryByRole("switch", { name: "Hide Panel Headers" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Hide Axes & Labels" }));
    expect(onAction).toHaveBeenCalledWith("set-hide-axes-labels", { value: false });
  });

  it("sets the Dock's own surface opacity", () => {
    const onAction = vi.fn();
    render(<DockViews state={{ edge: "bottom", dockSurfaceOpacity: 60 }} onAction={onAction} />);
    const slider = screen.getByRole("slider", { name: "Surface opacity" });
    expect(/** @type {HTMLInputElement} */ (slider).value).toBe("60");
    fireEvent.input(slider, { target: { value: "35" } });
    expect(onAction).toHaveBeenCalledWith("set-dock-surface-opacity", { value: 35 });
  });

  it("offers EWMH reservation on Linux without claiming full-screen support", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
    window.__PLVS_INITIAL_STATE__ = { agentControl: { dockCapabilities: { supported: true } } };
    try {
      render(<DockViews state={{ edge: "bottom", reserveSpace: true }} onAction={vi.fn()} />);
      expect(
        screen.getByRole("switch", { name: "Reserve Space" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(screen.queryByRole("switch", { name: "Above Full Screen" })).toBeNull();
    } finally {
      delete window.__PLVS_INITIAL_STATE__;
    }
  });

  it.each(["Win32", "MacIntel"])(
    "shows Above Full Screen on %s and sends toggle-above-full-screen",
    (platform) => {
      Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
      const onAction = vi.fn();
      render(<DockViews state={{ edge: "bottom", aboveFullScreen: true }} onAction={onAction} />);
      const toggle = screen.getByRole("switch", { name: "Above Full Screen" });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      expect(onAction).toHaveBeenCalledWith("toggle-above-full-screen");
    }
  );

  it("hides Above Full Screen on Linux", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
    render(<DockViews state={{ edge: "bottom", aboveFullScreen: true }} onAction={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "Above Full Screen" })).toBeNull();
  });
});
