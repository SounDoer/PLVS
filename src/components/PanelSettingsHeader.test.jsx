/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelSettingsHeader } from "./PanelSettingsHeader.jsx";

describe("PanelSettingsHeader", () => {
  it("uses themed tooltips for Back and Reset without native titles", () => {
    render(<PanelSettingsHeader title="Level Meter" onBack={vi.fn()} onReset={vi.fn()} />);

    const back = screen.getByRole("button", { name: "Back" });
    expect(back.title).toBe("");
    fireEvent.mouseEnter(back);
    expect(screen.getByRole("tooltip").textContent).toBe("Back");
    fireEvent.mouseLeave(back);

    const reset = screen.getByRole("button", { name: "Reset Level Meter settings" });
    expect(reset.parentElement?.title).toBe("");
    fireEvent.mouseEnter(reset.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Reset Level Meter settings");
  });

  it("keeps the default-state explanation hoverable while Reset is disabled", () => {
    render(<PanelSettingsHeader title="Stats" onReset={vi.fn()} isDefault />);

    const reset = screen.getByRole("button", { name: "Reset Stats settings" });
    expect(reset.disabled).toBe(true);
    fireEvent.mouseEnter(reset.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Using Defaults");
  });

  it("still arms the inline reset confirmation", () => {
    const onReset = vi.fn();
    render(<PanelSettingsHeader title="Stats" onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset Stats settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset Stats settings" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
