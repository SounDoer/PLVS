import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockModuleSettings } from "./DockModuleSettings.jsx";

function renderSettings(moduleId, props = {}) {
  const onChange = vi.fn();
  render(
    <DockModuleSettings
      moduleId={moduleId}
      controls={DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId]}
      onChange={onChange}
      onReset={vi.fn()}
      onBack={vi.fn()}
      onDone={vi.fn()}
      {...props}
    />
  );
  return onChange;
}

describe("DockModuleSettings", () => {
  it.each([
    ["level", "Level readout"],
    ["loudness", "Loudness metric"],
    ["spectrum", "Spectrum channel"],
    ["correlation", "Show correlation value"],
    ["stats", "M"],
    ["waveform", "Waveform view"],
    ["spectrogram", "Spectrogram channel"],
  ])("renders the %s settings family", (moduleId, label) => {
    renderSettings(moduleId);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("emits a complete updated controls object", () => {
    const onChange = renderSettings("level");
    fireEvent.change(screen.getByLabelText("Level readout"), { target: { value: "peak" } });
    expect(onChange).toHaveBeenCalledWith({ readout: "peak" });
  });

  it("exposes Back, Reset, and Done actions", () => {
    const onBack = vi.fn();
    const onReset = vi.fn();
    const onDone = vi.fn();
    renderSettings("level", { onBack, onReset, onDone });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
