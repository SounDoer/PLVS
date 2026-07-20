/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PanelSettingsMenu } from "./PanelSettingsMenu.jsx";
import { DEFAULT_PANEL_CONTROLS } from "@/lib/panelControls.js";

describe("PanelSettingsMenu", () => {
  it("renders a single settings trigger and opens level meter settings", () => {
    const onPanelControlsChange = vi.fn();

    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.queryByLabelText("level meter mode")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    const content = screen
      .getByLabelText("level meter mode")
      .closest("[data-slot='popover-content']");
    const contentClasses = content?.className.split(/\s+/) ?? [];
    expect(contentClasses).toContain("p-1");
    expect(contentClasses).not.toContain("p-2");
    expect(contentClasses).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(contentClasses).toContain("overflow-hidden");

    const scrollArea = content?.querySelector("[data-panel-settings-scroll]");
    const scrollAreaClasses = scrollArea?.className.split(/\s+/) ?? [];
    expect(scrollAreaClasses).toContain("min-h-0");
    expect(scrollAreaClasses).toContain("overflow-y-auto");
    expect(scrollAreaClasses).toContain("overscroll-contain");

    expect(screen.getByLabelText("level meter mode")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "level meter mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Momentary" }));
    expect(screen.getByText("Mode")).toBeTruthy();

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
    });
  });

  it("hides the trigger when the panel has no settings", () => {
    const { container } = render(<PanelSettingsMenu activeTab="waveform" />);

    expect(container.firstChild).toBeNull();
  });

  it("uses the panel instance title and confirms a scoped reset", () => {
    const onPanelControlsReset = vi.fn();
    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelTitle="Broadcast Meter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
        onPanelControlsChange={vi.fn()}
        onPanelControlsReset={onPanelControlsReset}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByRole("heading", { name: "Broadcast Meter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset Broadcast Meter settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset Broadcast Meter settings" }));
    expect(onPanelControlsReset).toHaveBeenCalledOnce();
  });

  it("disables reset while the panel already uses defaults", () => {
    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        onPanelControlsReset={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(screen.getByRole("button", { name: "Reset Level Meter settings" }).disabled).toBe(true);
  });

  it("renders spectrogram settings trigger when only range controls are available", () => {
    render(
      <PanelSettingsMenu
        activeTab="spectrogram"
        channelCount={2}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByLabelText("spectrogram y range min")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram y range max")).toBeTruthy();
  });

  it("renders Vectorscope settings for stereo sources", () => {
    render(
      <PanelSettingsMenu
        activeTab="vectorscope"
        channelCount={2}
        vectorscopeOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(screen.getByLabelText("vectorscope mode")).toBeTruthy();
    expect(screen.queryByLabelText("vectorscope channel pair")).toBeNull();
  });
});
