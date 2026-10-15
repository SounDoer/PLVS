/** @vitest-environment jsdom */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LevelMeterSettings } from "./LevelMeterSettings.jsx";
import { DEFAULT_PANEL_CONTROLS } from "../../lib/panelControls.js";
function Settings() {
  const [controls, setControls] = useState(DEFAULT_PANEL_CONTROLS);
  return <LevelMeterSettings panelControls={controls} onPanelControlsChange={setControls} />;
}
it("keeps the orientation label and selected option in sync across both switches", () => {
  render(<Settings />);
  for (const label of ["Horizontal", "Vertical", "Horizontal"]) {
    fireEvent.click(screen.getByLabelText("level meter orientation"));
    fireEvent.click(screen.getByRole("option", { name: label }));
    expect(screen.getByLabelText("level meter orientation").textContent).toBe(label);
    fireEvent.click(screen.getByLabelText("level meter orientation"));
    expect(screen.getByRole("option", { name: label }).getAttribute("data-state")).toBe("checked");
    fireEvent.keyDown(screen.getByRole("option", { name: label }), { key: "Escape" });
  }
});
it("places Orientation directly below Bar Colors", () => {
  render(<Settings />);
  const colors = screen.getByText("Bar Colors").closest("div.grid");
  expect(colors.nextElementSibling.textContent).toContain("Orientation");
});
