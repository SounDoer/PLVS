/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockModuleSettings } from "./DockModuleSettings.jsx";
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";

function renderSettings(moduleId, props = {}) {
  const onChange = vi.fn();
  render(
    <LoudnessProfileProvider>
      <DockModuleSettings
        moduleId={moduleId}
        controls={DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId]}
        onChange={onChange}
        onReset={vi.fn()}
        onBack={vi.fn()}
        {...props}
      />
    </LoudnessProfileProvider>
  );
  return onChange;
}

describe("DockModuleSettings", () => {
  it.each([
    ["level", "Level mode"],
    ["loudness", "loudness y range min"],
    ["spectrum", "Spectrum channel"],
    ["correlation", "Vectorscope channel pair"],
    ["stats", "Edit metrics"],
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

  it("reuses the normal Loudness Layers and Y range settings", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness;
    const onChange = renderSettings("loudness");

    expect(screen.queryByLabelText("Loudness metric")).toBeNull();
    expect(screen.queryByLabelText("Show loudness sparkline")).toBeNull();
    expect(screen.queryByLabelText("Show loudness reference")).toBeNull();
    // The reference value belongs to the active Loudness Profile, not to this panel.
    expect(screen.queryByLabelText("Loudness reference")).toBeNull();
    expect(screen.getByLabelText("loudness y range min").value).toBe("-64");
    expect(screen.getByLabelText("loudness y range max").value).toBe("0");
    const settingsRows = screen.getByText("Readouts").closest("div")?.parentElement?.children;
    expect(settingsRows?.[settingsRows.length - 1]?.textContent).toContain("Readouts");

    fireEvent.click(screen.getByLabelText("Show Loudness readouts"));
    expect(onChange).toHaveBeenCalledWith({ ...controls, showReadouts: false });

    fireEvent.click(screen.getByRole("button", { name: "Edit layers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
    });
  });

  it("uses the runtime vectorscope pair options", () => {
    const vectorscopeOptions = [
      { key: "0-1", label: "L/R", x: 0, y: 1, group: "Common" },
      { key: "2-3", label: "Ls/Rs", x: 2, y: 3, group: "Common" },
    ];
    const onChange = renderSettings("correlation", { vectorscopeOptions });

    fireEvent.click(screen.getByLabelText("Vectorscope channel pair"));
    fireEvent.click(screen.getByRole("option", { name: "Ls/Rs" }));
    expect(onChange).toHaveBeenCalledWith({ pair: { x: 2, y: 3 } });
  });

  it("uses runtime Spectrum channels and only shows View for a pair", () => {
    const spectrumOptions = [
      { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
      { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
    ];
    const onChange = renderSettings("spectrum", { spectrumOptions, channelCount: 6 });

    expect(screen.getByLabelText("Spectrum view")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Spectrum channel"));
    fireEvent.click(screen.getByRole("option", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      channel: { type: "single", ch: 2 },
    });
  });

  it("hides Spectrum Channel for stereo and View for a single channel", () => {
    const pairOption = [{ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } }];
    const { unmount } = render(
      <DockModuleSettings
        moduleId="spectrum"
        controls={DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum}
        spectrumOptions={pairOption}
        channelCount={2}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Spectrum channel")).toBeNull();
    expect(screen.getByLabelText("Spectrum view")).toBeTruthy();
    unmount();

    renderSettings("spectrum", {
      controls: {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
        channel: { type: "single", ch: 2 },
      },
      spectrumOptions: [{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }],
      channelCount: 6,
    });
    expect(screen.getByLabelText("Spectrum channel")).toBeTruthy();
    expect(screen.queryByLabelText("Spectrum view")).toBeNull();
  });

  it("exposes Spectrum X range and quarter-decibel tilt steps", () => {
    renderSettings("spectrum");

    expect(screen.getByLabelText("spectrum x range min").value).toBe("20");
    expect(screen.getByLabelText("spectrum x range max").value).toBe("20000");
    expect(screen.getByLabelText("spectrum tilt").step).toBe("0.25");
    expect(screen.queryByText("3.00 dB/oct")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText("spectrum tilt"));
    expect(
      screen.getAllByRole("tooltip").some((tooltip) => tooltip.textContent === "3.00 dB/oct")
    ).toBe(true);
  });

  it("matches the normal Spectrum settings order", () => {
    renderSettings("spectrum");

    const peakRow = screen.getByText("Max hold").closest("div.grid");
    const speedRow = screen.getByText("Speed").closest("div.grid");
    const smoothingRow = screen.getByText("Smoothing").closest("div.grid");
    expect(peakRow.compareDocumentPosition(speedRow) & 4).toBeTruthy();
    expect(speedRow.compareDocumentPosition(smoothingRow) & 4).toBeTruthy();
    expect(screen.queryByText("Peak labels")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(15);
    expect(screen.queryByRole("button", { name: "Reset stats" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Integrated Dynamics" }));
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      statsVisibleIds: [...controls.statsVisibleIds, "plr"],
    });
  });

  it("uses runtime Spectrogram channels", () => {
    const spectrumOptions = [
      { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
      { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
    ];
    const onChange = renderSettings("spectrogram", { spectrumOptions, channelCount: 6 });

    fireEvent.click(screen.getByLabelText("Spectrogram channel"));
    fireEvent.click(screen.getByRole("option", { name: "C" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrogram,
      channel: { type: "single", ch: 2 },
    });
  });

  it("hides the Spectrogram Channel selector for stereo", () => {
    renderSettings("spectrogram", {
      spectrumOptions: [{ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } }],
      channelCount: 2,
    });

    expect(screen.queryByLabelText("Spectrogram channel")).toBeNull();
    expect(screen.getByLabelText("spectrogram y range min")).toBeTruthy();
    expect(screen.queryByLabelText("Spectrogram level range min")).toBeNull();
  });

  it("does not expose settings for Waveform", () => {
    renderSettings("waveform");
    expect(screen.queryByText("Waveform settings")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("exposes Back and Reset actions without a title close button", () => {
    const onBack = vi.fn();
    const onReset = vi.fn();
    renderSettings("level", {
      title: "Level Meter",
      controls: { mode: "rms", readout: "live", showLabels: true },
      onBack,
      onReset,
    });
    expect(screen.getByRole("heading", { name: "Level Meter" })).toBeTruthy();
    expect(screen.queryByText("Level Meter settings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Level Meter settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset Level Meter settings" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("keeps a fixed reset action slot while confirmation is armed", () => {
    renderSettings("level", {
      title: "Level Meter",
      controls: { mode: "rms", readout: "live", showLabels: true },
    });
    const reset = screen.getByRole("button", { name: "Reset Level Meter settings" });
    const slot = reset.closest("span.flex.w-10");
    fireEvent.click(reset);
    expect(slot?.className).toContain("w-10");
    expect(screen.getByRole("button", { name: "Cancel reset Level Meter settings" })).toBeTruthy();
  });
});
