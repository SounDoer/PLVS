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
    ["loudness", "loudness range min"],
    ["spectrum", "Spectrum channel"],
    ["correlation", "Vectorscope channel pair"],
    ["stats", "Edit metrics"],
    ["waveform", "waveform frequency color"],
    ["spectrogram", "Spectrogram channel"],
  ])("renders the %s settings family", (moduleId, label) => {
    renderSettings(moduleId);
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("uses the shared Waveform controls in Dock settings", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.waveform,
      waveformFrequencyColor: true,
    };
    const onChange = renderSettings("waveform", { controls });

    expect(screen.getByLabelText("waveform low mid split").value).toBe("200");
    expect(screen.getByLabelText("waveform mid high split").value).toBe("2000");
    fireEvent.click(screen.getByLabelText("waveform centroid"));
    expect(onChange).toHaveBeenCalledWith({ ...controls, waveformCentroid: true });
  });

  it("emits a complete updated controls object", () => {
    const onChange = renderSettings("level");
    fireEvent.click(screen.getByLabelText("Level mode"));
    fireEvent.click(screen.getByRole("option", { name: "RMS" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
      levelMeterMode: "rms",
      readout: "live",
    });
  });

  it("edits the thresholds of the current level mode", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
      levelMeterBarColors: "levelZones",
    };
    const onChange = renderSettings("level", { controls });
    const critical = screen.getByLabelText("level meter peak thresholds critical");
    expect(critical.value).toBe("-1");
    fireEvent.change(critical, { target: { value: "0" } });
    fireEvent.keyDown(critical, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      levelMeterPeakCriticalDb: 0,
    });
  });

  it("has no thresholds in loudness modes", () => {
    renderSettings("level", {
      controls: {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
        levelMeterBarColors: "levelZones",
        levelMeterMode: "momentary",
      },
    });
    expect(screen.queryByText("Warning / Critical")).toBeNull();
  });

  it("edits the RMS thresholds without touching Peak", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
      levelMeterBarColors: "levelZones",
      levelMeterMode: "rms",
    };
    const onChange = renderSettings("level", { controls });
    const critical = screen.getByLabelText("level meter rms thresholds critical");
    fireEvent.change(critical, { target: { value: "-6" } });
    fireEvent.keyDown(critical, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      levelMeterRmsCriticalDb: -6,
    });
  });

  it("switches Bar Colors and hides thresholds under Gradient", () => {
    const onChange = renderSettings("level");
    expect(screen.queryByText("Warning / Critical")).toBeNull();
    fireEvent.click(screen.getByLabelText("level meter bar colors"));
    fireEvent.click(screen.getByRole("option", { name: "Level Zones" }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
      levelMeterBarColors: "levelZones",
    });
  });

  it("uses the shared Live and Labels controls for scalar Level modes", () => {
    const controls = { mode: "shortTerm", readout: "live", showLabels: true };
    const onChange = renderSettings("level", { controls });

    fireEvent.click(screen.getByLabelText("Level readout"));
    expect(screen.getByRole("option", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Playback Max" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Live Peak" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Show Level labels"));
    expect(onChange).toHaveBeenCalledWith({ ...controls, showLabels: false });
  });

  it("reuses the normal Loudness Layers and Loudness Range settings", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness;
    const onChange = renderSettings("loudness");

    expect(screen.queryByLabelText("Loudness metric")).toBeNull();
    expect(screen.queryByLabelText("Show loudness sparkline")).toBeNull();
    expect(screen.queryByLabelText("Show loudness reference")).toBeNull();
    // The reference value belongs to the active Loudness Profile, not to this panel.
    expect(screen.queryByLabelText("Loudness reference")).toBeNull();
    expect(screen.getByLabelText("loudness range min").value).toBe("-64");
    expect(screen.getByLabelText("loudness range max").value).toBe("0");
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
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation,
      vectorscopePair: { x: 2, y: 3 },
    });
  });

  it("shows Vectorscope mode first and Max hold only for Polar Level", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation;
    const onChange = renderSettings("correlation");

    const modeRow = screen.getByText("Mode").closest("div.grid");
    const pairRow = screen.getByText("Channel Pair").closest("div.grid");
    expect(modeRow.compareDocumentPosition(pairRow) & 4).toBeTruthy();
    expect(screen.queryByLabelText("Vectorscope max hold")).toBeNull();

    fireEvent.click(screen.getByLabelText("Vectorscope mode"));
    fireEvent.click(screen.getByRole("option", { name: "Polar Level" }));
    expect(onChange).toHaveBeenCalledWith({ ...controls, vectorscopeMode: "polarLevel" });
  });

  it("shows live Persistence only for Polar Sample", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation,
      vectorscopeMode: "polarSample",
    };
    const onChange = renderSettings("correlation", { controls });
    const persistence = screen.getByLabelText("Vectorscope polar sample persistence");

    expect(persistence.value).toBe("400");
    fireEvent.change(persistence, { target: { value: "650" } });
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      vectorscopePolarSamplePersistenceMs: 650,
    });
  });

  it("toggles Max hold in Polar Level mode", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation,
      vectorscopeMode: "polarLevel",
    };
    const onChange = renderSettings("correlation", { controls });

    fireEvent.click(screen.getByLabelText("Vectorscope max hold"));
    expect(onChange).toHaveBeenCalledWith({
      ...controls,
      vectorscopePolarLevelMaxHold: true,
    });
  });

  it("commits the dock Stereo Map speed on release, not on every change", () => {
    const onChange = renderSettings("stereoMap", { channelCount: 2 });

    // The dock renders its own Stereo Map speed row rather than going through the control table,
    // so the key-churn guard has to be wired here too -- see SettingsSlider's commitOnRelease note.
    const speed = screen.getByLabelText("Stereo Map speed");
    fireEvent.change(speed, { target: { value: "80" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(speed);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap,
      stereoMapSpeedPercent: 80,
    });
  });

  it("shows Dock Color Blend only for Stereo Map Position", () => {
    const onChange = renderSettings("stereoMap", { channelCount: 2 });
    const blend = screen.getByLabelText("Stereo Map color blend");
    expect(blend.value).toBe("50");
    fireEvent.change(blend, { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap,
      stereoMapColorBlendPercent: 25,
    });
  });

  it("hides Dock Color Blend outside Stereo Map Position", () => {
    renderSettings("stereoMap", {
      channelCount: 2,
      controls: {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap,
        stereoMapMode: "correlation",
      },
    });
    expect(screen.queryByLabelText("Stereo Map color blend")).toBeNull();
    expect(screen.getByLabelText("Stereo Map energy fade strength")).toBeTruthy();
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
      spectrumChannel: { type: "single", ch: 2 },
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
        spectrumChannel: { type: "single", ch: 2 },
      },
      spectrumOptions: [{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }],
      channelCount: 6,
    });
    expect(screen.getByLabelText("Spectrum channel")).toBeTruthy();
    expect(screen.queryByLabelText("Spectrum view")).toBeNull();
  });

  it("exposes Spectrum Frequency Range and quarter-decibel tilt steps", () => {
    renderSettings("spectrum");

    expect(screen.getByLabelText("spectrum frequency range min").value).toBe("20");
    expect(screen.getByLabelText("spectrum frequency range max").value).toBe("20000");
    expect(screen.getByLabelText("spectrum tilt").step).toBe("0.25");
    expect(screen.queryByText("3.00 dB/oct")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText("spectrum tilt"));
    expect(
      screen.getAllByRole("tooltip").some((tooltip) => tooltip.textContent === "3.00 dB/oct")
    ).toBe(true);
  });

  it("matches the normal Spectrum settings order", () => {
    renderSettings("spectrum");

    const peakRow = screen.getByText("Max").closest("div.grid");
    const speedRow = screen.getByText("Speed").closest("div.grid");
    const smoothingRow = screen.getByText("Smoothing").closest("div.grid");
    expect(peakRow.compareDocumentPosition(speedRow) & 4).toBeTruthy();
    expect(speedRow.compareDocumentPosition(smoothingRow) & 4).toBeTruthy();
    expect(screen.queryByText("Peak Labels")).toBeNull();
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
      spectrumChannel: { type: "single", ch: 2 },
    });
  });

  it("hides the Spectrogram Channel selector for stereo", () => {
    renderSettings("spectrogram", {
      spectrumOptions: [{ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } }],
      channelCount: 2,
    });

    expect(screen.queryByLabelText("Spectrogram channel")).toBeNull();
    expect(screen.getByLabelText("spectrogram frequency range min")).toBeTruthy();
    expect(screen.queryByLabelText("spectrogram level range min")).toBeNull();
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
    const slot = reset.closest(".flex.w-10");
    fireEvent.click(reset);
    expect(slot?.className).toContain("w-10");
    expect(screen.getByRole("button", { name: "Cancel reset Level Meter settings" })).toBeTruthy();
  });
});
