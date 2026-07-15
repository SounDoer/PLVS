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
    ["level", "Level mode"],
    ["loudness", "Loudness reference"],
    ["spectrum", "Spectrum channel"],
    ["correlation", "Show correlation value"],
    ["stats", "Metrics"],
    ["waveform", "Waveform view"],
    ["spectrogram", "Spectrogram channel"],
  ])("renders the %s settings family", (moduleId, label) => {
    renderSettings(moduleId);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("emits a complete updated controls object", () => {
    const onChange = renderSettings("level");
    fireEvent.click(screen.getByLabelText("Level mode"));
    fireEvent.click(screen.getByRole("option", { name: "RMS" }));
    expect(onChange).toHaveBeenCalledWith({
      mode: "rms",
      readout: "live",
      showLabels: true,
    });
  });

  it("uses the shared Live and Labels controls for scalar Level modes", () => {
    const controls = { mode: "shortTerm", readout: "live", showLabels: true };
    const onChange = renderSettings("level", { controls });

    fireEvent.click(screen.getByLabelText("Level readout"));
    expect(screen.getByRole("option", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Playback max" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Live Peak" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Show Level labels"));
    expect(onChange).toHaveBeenCalledWith({ ...controls, showLabels: false });
  });

  it("reuses the normal Loudness Ref, Layers, and Y range settings", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness;
    const onChange = renderSettings("loudness");

    expect(screen.queryByLabelText("Loudness metric")).toBeNull();
    expect(screen.queryByLabelText("Show loudness sparkline")).toBeNull();
    expect(screen.queryByLabelText("Show loudness reference")).toBeNull();
    expect(screen.getByLabelText("Loudness reference").value).toBe("-23");
    expect(screen.getByLabelText("loudness y range min").value).toBe("-64");
    expect(screen.getByLabelText("loudness y range max").value).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Edit layers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
    });
  });

  it("uses the themed inline selector instead of a native select", () => {
    renderSettings("spectrogram");

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByLabelText("Spectrogram channel"));
    expect(screen.getByRole("listbox", { name: "Spectrogram channel" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Channels 1 + 2" })).toBeTruthy();
  });

  it("reuses the sortable multi-select Stats list without a selection cap", () => {
    const controls = {
      statsVisibleIds: ["integrated", "truePeak", "lra", "psr"],
      statsOrder: DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.statsOrder,
    };
    const onChange = renderSettings("stats", { controls });

    expect(screen.getByText("4 visible")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(15);
    expect(screen.queryByRole("button", { name: "Reset stats" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Integrated Dynamics" }));
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      statsVisibleIds: [...controls.statsVisibleIds, "plr"],
    });
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
