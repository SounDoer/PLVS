/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockViews } from "./DockViews.jsx";

describe("Dock Views", () => {
  it("offers annotations without inventing a panel header control", () => {
    const onAction = vi.fn();
    render(<DockViews state={{ edge: "bottom", hideAxesAndLabels: true }} onAction={onAction} />);
    expect(screen.queryByRole("switch", { name: "Hide Panel Headers" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Hide Axes & Labels" }));
    expect(onAction).toHaveBeenCalledWith("set-hide-axes-labels", { value: false });
  });

  it("shows Above Full Screen on Windows and sends toggle-above-full-screen", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    const onAction = vi.fn();
    render(<DockViews state={{ edge: "bottom", aboveFullScreen: true }} onAction={onAction} />);
    const toggle = screen.getByRole("switch", { name: "Above Full Screen" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onAction).toHaveBeenCalledWith("toggle-above-full-screen");
  });

  it("hides Above Full Screen on macOS", () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    render(<DockViews state={{ edge: "bottom", aboveFullScreen: true }} onAction={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "Above Full Screen" })).toBeNull();
  });
});
