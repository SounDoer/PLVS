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
});
