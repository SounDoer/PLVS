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
    fireEvent.click(screen.getByLabelText("Level readout"));
    fireEvent.click(screen.getByRole("option", { name: "Peak" }));
    expect(onChange).toHaveBeenCalledWith({ readout: "peak" });
  });

  it("uses the themed inline selector instead of a native select", () => {
    renderSettings("spectrogram");

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByLabelText("Spectrogram channel"));
    expect(screen.getByRole("listbox", { name: "Spectrogram channel" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Channels 1 + 2" })).toBeTruthy();
  });

  it("exposes Back and Reset actions without a title close button", () => {
    const onBack = vi.fn();
    const onReset = vi.fn();
    renderSettings("level", { onBack, onReset });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});
