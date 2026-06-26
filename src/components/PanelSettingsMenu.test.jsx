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

    expect(screen.getByLabelText("level meter mode")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "level meter mode" }));
    fireEvent.click(screen.getByRole("option", { name: "M" }));
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
});
