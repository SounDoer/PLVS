/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render as renderInDom, screen } from "@testing-library/react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { LoudnessProfileProvider } from "@/hooks/LoudnessProfileContext.jsx";
import { openExternalUrl } from "@/ipc/openExternal.js";
import { DEFAULT_PANEL_CONTROLS } from "@/lib/panelControls.js";
import { settingsStore } from "@/persistence/index.js";
import { profileSelectionId } from "@/lib/loudnessProfileCatalog.js";
import { STATS_CANONICAL_ORDER } from "@/lib/statsCatalog.js";
import { PanelChromeProvider, PanelInstanceProvider } from "@/workspace/AudioDataContext.jsx";
import { PanelDataProviders } from "@/workspace/PanelDataProviders.jsx";
import { DragProvider } from "@/workspace/DragContext.jsx";
import { LeafView } from "@/workspace/LeafView.jsx";
import { SplitLayout } from "@/workspace/SplitLayout.jsx";
import { WorkspaceProvider, useWorkspaceStore } from "@/workspace/WorkspaceContext.jsx";

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [],
};

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
  Reorder: {
    Group: ({ children, role, "aria-label": ariaLabel, className }) => (
      <div role={role} aria-label={ariaLabel} className={className}>
        {children}
      </div>
    ),
    Item: ({ children, className }) => <div className={className}>{children}</div>,
  },
  useDragControls: () => ({ start: () => {} }),
  useReducedMotion: () => false,
  useSpring: () => ({ set: vi.fn() }),
}));

vi.mock("@/ipc/openExternal.js", () => ({
  openExternalUrl: vi.fn(),
}));

/// PanelSettingsContent reads the profile, which now lives in a provider rather than a per-caller
/// hook, so every render in this file needs one in its tree.
function render(ui, options) {
  return renderInDom(ui, { wrapper: LoudnessProfileProvider, ...options });
}

// A 60 second recording at the history sample rate, viewed 30 seconds wide from the live edge.
function historyDataWithViewport(over = {}) {
  return {
    sourceMode: "live",
    totalSamples: 600,
    visibleSamples: 300,
    effectiveOffsetSamples: 0,
    clampedWindowSec: 30,
    effectiveOffsetSec: 0,
    historyMaxWindowSec: 7200,
    setHistoryWindowSec: vi.fn(),
    setHistoryOffsetSec: vi.fn(),
    ...over,
  };
}

function renderWithHistory(ui, historyData = historyDataWithViewport()) {
  return render(<PanelDataProviders historyData={historyData}>{ui}</PanelDataProviders>);
}

function timeRangeInputs() {
  return [screen.getByLabelText("time range min"), screen.getByLabelText("time range max")];
}

function axisViewportInstance(over = {}) {
  return {
    panelControls: DEFAULT_PANEL_CONTROLS,
    onPanelControlsChange: vi.fn(),
    axisViewports: { frequency: { min: 20, max: 20000, linked: true } },
    setAxisViewportRange: vi.fn(),
    setAxisViewportLinked: vi.fn(),
    ...over,
  };
}

function renderWithInstance(ui, instance) {
  return render(
    <PanelDataProviders historyData={historyDataWithViewport()}>
      <PanelInstanceProvider value={instance}>{ui}</PanelInstanceProvider>
    </PanelDataProviders>
  );
}

describe("PanelSettingsContent frequency link toggle", () => {
  it.each([
    ["spectrum", "spectrum frequency range"],
    ["spectrogram", "spectrogram frequency range"],
    ["stereo-map", "stereo map frequency range"],
  ])("shows the shared frequency range in the %s settings", (activeTab, ariaLabel) => {
    renderWithInstance(
      <PanelSettingsContent
        activeTab={activeTab}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      axisViewportInstance({
        axisViewports: { frequency: { min: 200, max: 5000, linked: true } },
      })
    );

    expect(screen.getByLabelText(`${ariaLabel} min`).value).toBe("200");
    expect(screen.getByLabelText(`${ariaLabel} max`).value).toBe("5000");
  });

  it.each([["spectrum"], ["spectrogram"], ["stereo-map"]])(
    "offers the toggle on the %s panel, which shares the frequency axis",
    (activeTab) => {
      renderWithInstance(
        <PanelSettingsContent
          activeTab={activeTab}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
        />,
        axisViewportInstance()
      );

      expect(screen.getByLabelText("link frequency range")).toBeTruthy();
    }
  );

  it.each([["loudness"], ["waveform"], ["levelMeter"]])(
    "leaves it off the %s panel, which has no frequency axis",
    (activeTab) => {
      renderWithInstance(
        <PanelSettingsContent
          activeTab={activeTab}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
        />,
        axisViewportInstance()
      );

      expect(screen.queryByLabelText("link frequency range")).toBeNull();
    }
  );

  it("reads as linked by default", () => {
    renderWithInstance(
      <PanelSettingsContent
        activeTab="spectrum"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      axisViewportInstance()
    );

    const toggle = screen.getByLabelText("link frequency range");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseEnter(toggle);
    expect(screen.getByText("Unlink Frequency Range").getAttribute("role")).toBe("tooltip");
  });

  it("leaves the group when pressed while linked", () => {
    const instance = axisViewportInstance();
    renderWithInstance(
      <PanelSettingsContent
        activeTab="spectrum"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      instance
    );

    fireEvent.click(screen.getByLabelText("link frequency range"));

    expect(instance.setAxisViewportLinked).toHaveBeenCalledWith("frequency", false);
  });

  it("rejoins when pressed while unlinked", () => {
    const instance = axisViewportInstance({
      axisViewports: { frequency: { min: 200, max: 5000, linked: false } },
    });
    renderWithInstance(
      <PanelSettingsContent
        activeTab="spectrum"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      instance
    );
    const toggle = screen.getByLabelText("link frequency range");

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.mouseEnter(toggle);
    expect(screen.getByText("Link Frequency Range").getAttribute("role")).toBe("tooltip");
    fireEvent.click(toggle);

    expect(instance.setAxisViewportLinked).toHaveBeenCalledWith("frequency", true);
  });

  it("stays out of the way with no workspace instance behind it", () => {
    // The dock composes its editor from the exported rows, and never mounts this dispatch.
    renderWithInstance(
      <PanelSettingsContent
        activeTab="spectrum"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      { panelControls: DEFAULT_PANEL_CONTROLS, onPanelControlsChange: vi.fn() }
    );

    expect(screen.queryByLabelText("link frequency range")).toBeNull();
  });
});

describe("PanelSettingsContent time link toggle", () => {
  it.each([["loudness"], ["spectrogram"], ["waveform"]])(
    "shows the time membership control in %s settings",
    (activeTab) => {
      const setAxisViewportLinked = vi.fn();
      renderWithInstance(
        <PanelSettingsContent
          activeTab={activeTab}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
        />,
        axisViewportInstance({
          axisViewports: { time: { windowSec: 60, offsetSec: 0, linked: true } },
          setAxisViewportLinked,
        })
      );

      const toggle = screen.getByRole("button", { name: "link time range" });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      fireEvent.mouseEnter(toggle);
      expect(screen.getByText("Unlink Time Range").getAttribute("role")).toBe("tooltip");
      fireEvent.click(toggle);
      expect(setAxisViewportLinked).toHaveBeenCalledWith("time", false);
    }
  );
});

describe("PanelSettingsContent time range row", () => {
  it.each([["loudness"], ["waveform"], ["spectrogram"]])(
    "offers the row on the %s panel, which has a time axis",
    (activeTab) => {
      renderWithHistory(
        <PanelSettingsContent
          activeTab={activeTab}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
        />
      );

      expect(screen.getByText("Time Range")).toBeTruthy();
    }
  );

  it.each([["spectrum"], ["stereo-map"], ["levelMeter"], ["vectorscope"]])(
    "leaves it off the %s panel, which has no time axis",
    (activeTab) => {
      renderWithHistory(
        <PanelSettingsContent
          activeTab={activeTab}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
          vectorscopeOptions={[{ key: "0:1", label: "1/2" }]}
        />
      );

      expect(screen.queryByText("Time Range")).toBeNull();
    }
  );

  it("reads down from the left in live mode, the way the rail does", () => {
    renderWithHistory(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );
    const [min, max] = timeRangeInputs();

    expect(min.value).toBe("30");
    expect(max.value).toBe("0");
  });

  it("reads up from the left in file mode, the way the rail does", () => {
    renderWithHistory(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      historyDataWithViewport({ sourceMode: "file" })
    );
    const [min, max] = timeRangeInputs();

    expect(Number(min.value)).toBeLessThan(Number(max.value));
  });

  it("carries no unit suffix, matching the frequency row", () => {
    renderWithHistory(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );
    const [min] = timeRangeInputs();

    expect(min.value).toBe("30");
    expect(min.value).not.toContain("s");
  });

  it("commits an edit to the shared window and offset", () => {
    const historyData = historyDataWithViewport();
    renderWithHistory(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />,
      historyData
    );
    const [min] = timeRangeInputs();

    fireEvent.change(min, { target: { value: "20" } });
    fireEvent.blur(min);

    expect(historyData.setHistoryWindowSec).toHaveBeenCalledWith(20);
    expect(historyData.setHistoryOffsetSec).toHaveBeenCalledWith(0);
  });

  it("stays out of the way when no history context is mounted", () => {
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(screen.queryByText("Time Range")).toBeNull();
  });
});

function TestPanelDataProviders({ value = {}, panelChromeData = value, children }) {
  return (
    <PanelDataProviders
      frameData={value}
      historyData={value}
      metricsData={value}
      panelChromeData={panelChromeData}
    >
      {children}
    </PanelDataProviders>
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  localStorage.clear();
});

function WorkspaceStateProbe({ onState }) {
  const { state } = useWorkspaceStore();
  onState(state);
  return null;
}

describe("PanelSettingsContent", () => {
  it("shows Waveform spectral toggles and reveals validated frequency split inputs", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "waveform",
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    const { rerender } = render(<PanelSettingsContent {...props} />);

    expect(screen.getByLabelText("waveform frequency color").getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(screen.getByLabelText("waveform centroid").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("waveform low mid split")).toBeNull();
    expect(screen.queryByText(/legend/i)).toBeNull();

    fireEvent.click(screen.getByLabelText("waveform frequency color"));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      waveformFrequencyColor: true,
    });

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, waveformFrequencyColor: true }}
      />
    );
    const lowMidInput = screen.getByLabelText("waveform low mid split");
    const midHighInput = screen.getByLabelText("waveform mid high split");
    expect(lowMidInput.value).toBe("200");
    expect(midHighInput.value).toBe("2000");
    expect(screen.getAllByText("Hz")).toHaveLength(2);

    fireEvent.change(lowMidInput, { target: { value: "2500" } });
    fireEvent.keyDown(lowMidInput, { key: "Enter" });
    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(lowMidInput.value).toBe("200");

    fireEvent.change(lowMidInput, { target: { value: "320" } });
    fireEvent.keyDown(lowMidInput, { key: "Enter" });
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      waveformFrequencyColor: true,
      waveformLowMidSplitHz: 320,
    });
  });

  it("renders Level Meter mode as a labeled settings row and updates mode", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Mode")).toBeTruthy();
    const modeButton = screen.getByLabelText("level meter mode");
    const modeRow = screen.getByText("Mode").parentElement;
    const modeControlCell = modeButton.parentElement?.parentElement;
    expect(modeButton).toBeTruthy();
    expect(modeButton.className).toContain("h-6");
    expect(modeButton.className).toContain("text-popover-foreground");
    expect(modeButton.className).not.toContain("focus:border");
    expect(modeButton.className).not.toContain("text-muted-foreground");
    expect(modeButton.className).not.toContain("h-7");
    expect(modeButton.className).not.toContain("min-w-[");
    expect(modeButton.textContent).not.toContain("Edit");
    expect(modeButton.querySelector("svg")?.className.baseVal).toContain("size-[1em]");
    expect(screen.getByText("Mode").className).toContain("text-muted-foreground");
    expect(screen.getByText("Mode").className).toContain("h-6");
    expect(screen.getByText("Mode").className).toContain("items-center");
    expect(screen.getByText("Mode").className).not.toContain("text-popover-foreground");
    expect(modeControlCell?.className).toContain("min-h-6");
    expect(modeControlCell?.className).toContain("items-center");
    expect(modeRow?.className).toContain("min-h-6");
    expect(modeRow?.className).toContain("gap-2");
    expect(modeRow?.className).toContain("grid-cols-[max-content_minmax(0,1fr)]");
    expect(modeRow?.className).not.toContain("grid-cols-[4.75rem");
    expect(modeRow?.className).not.toContain("min-h-7");
    expect(modeRow?.className).not.toContain("gap-4");
    expect(container.firstChild?.className).toContain("w-full");
    expect(container.firstChild?.className).toContain("max-w-full");
    expect(container.firstChild?.className).not.toContain("w-[17rem]");
    expect(screen.getByText("Peak")).toBeTruthy();

    expect(screen.queryByRole("combobox")).toBeNull();
    const modeRowClassBeforeOpen = modeRow?.className;
    fireEvent.click(screen.getByRole("button", { name: "level meter mode" }));
    expect(modeRow?.className).toBe(modeRowClassBeforeOpen);
    expect(modeButton.className).not.toContain("w-full");
    expect(modeButton.textContent).not.toContain("Hide");
    const peakOption = screen.getByRole("option", { name: "Peak" });
    expect(peakOption.querySelector("[data-settings-option-check]")?.className).toContain("size-3");
    expect(peakOption.querySelector("svg")?.className.baseVal).toContain("size-[1em]");
    expect(screen.getByRole("option", { name: "RMS" })).toBeTruthy();
    const momentaryOption = screen.getByRole("option", { name: "Momentary" });
    expect(modeRow?.contains(momentaryOption)).toBe(true);
    expect(momentaryOption.getAttribute("data-settings-option-row")).toBe("true");
    expect(momentaryOption.querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3"
    );
    fireEvent.click(momentaryOption);

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
    });
  });

  it("shows the TP Max switch and hides the value marker switch in Peak mode", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.queryByText("Floating Value")).toBeNull();
    expect(screen.queryByText("Playback Max")).toBeNull();
    expect(screen.queryByRole("switch", { name: "level meter floating value" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "level meter playback max" })).toBeNull();
    expect(screen.getByText("TP Max")).toBeTruthy();
    const switchButton = screen.getByRole("switch", { name: "level meter TP Max" });
    expect(switchButton.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(switchButton);

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterTpMaxMarker: true,
    });
  });

  it("renders the Level Meter playback max and floating value switches for Momentary", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    const playbackMaxLabel = screen.getByText("Playback Max");
    const floatingValueLabel = screen.getByText("Floating Value");
    expect(
      screen.getByText("Show the latest playback max as the readout while the bar stays live.")
    ).toBeTruthy();
    expect(playbackMaxLabel.compareDocumentPosition(floatingValueLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByText("Floating Value")).toBeTruthy();
    expect(screen.queryByText("TP Max")).toBeNull();
    const playbackMaxSwitch = screen.getByRole("switch", { name: "level meter playback max" });
    expect(playbackMaxSwitch.getAttribute("aria-checked")).toBe("false");
    const switchButton = screen.getByRole("switch", { name: "level meter floating value" });
    expect(switchButton.getAttribute("aria-checked")).toBe("false");
    expect(switchButton.className).toContain("h-4");
    expect(switchButton.className).toContain("w-7");
    expect(switchButton.className).toContain("data-[state=checked]:bg-primary");
    expect(switchButton.querySelector("[data-slot='switch-thumb']")?.className).toContain("size-3");

    fireEvent.click(playbackMaxSwitch);
    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
      levelMeterPlaybackMax: true,
    });

    fireEvent.click(switchButton);

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
      levelMeterValueMarker: true,
    });
  });

  it("renders RMS as a Peak-family mode with playback max but no floating value", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Playback Max")).toBeTruthy();
    expect(screen.queryByText("Floating Value")).toBeNull();
    expect(screen.queryByText("TP Max")).toBeNull();
    expect(screen.getByLabelText("level meter range min").value).toBe("-60");
    expect(screen.getByLabelText("level meter range max").value).toBe("3");
  });

  it("commits the RMS range to the level keys the Level Meter panel reads", () => {
    // RMS reads the Peak-family range, so it has to write that same pair. Committing to the
    // loudness pair instead left the edit invisible on the meter and quietly moved the range
    // Momentary and Short-term use.
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.change(screen.getByLabelText("level meter range min"), {
      target: { value: "-40" },
    });
    fireEvent.blur(screen.getByLabelText("level meter range min"));

    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "rms",
      levelMeterYMinDb: -40,
      levelMeterYMaxDb: 3,
    });
  });

  it("commits the Level Meter range for the active mode", () => {
    const onPanelControlsChange = vi.fn();
    const { rerender } = render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByLabelText("level meter range min").value).toBe("-60");
    expect(screen.getByLabelText("level meter range max").value).toBe("3");
    fireEvent.change(screen.getByLabelText("level meter range min"), {
      target: { value: "-48" },
    });
    fireEvent.change(screen.getByLabelText("level meter range max"), {
      target: { value: "0" },
    });
    fireEvent.blur(screen.getByLabelText("level meter range max"));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterYMinDb: -48,
      levelMeterYMaxDb: 0,
    });

    rerender(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          levelMeterMode: "rms",
          levelMeterYMinDb: -48,
          levelMeterYMaxDb: 0,
        }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );
    expect(screen.getByLabelText("level meter range min").value).toBe("-48");
    expect(screen.getByLabelText("level meter range max").value).toBe("0");

    rerender(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );
    expect(screen.getByLabelText("level meter range min").value).toBe("-64");
    expect(screen.getByLabelText("level meter range max").value).toBe("0");
    fireEvent.change(screen.getByLabelText("level meter range min"), {
      target: { value: "-48" },
    });
    fireEvent.change(screen.getByLabelText("level meter range max"), {
      target: { value: "-6" },
    });
    fireEvent.blur(screen.getByLabelText("level meter range max"));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
      loudnessYMinDb: -48,
      loudnessYMaxDb: -6,
    });
  });

  it("selects Short-term from the Level Meter mode chip", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "level meter mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Short-term" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "shortTerm",
    });
  });

  it("does not render channel controls below multichannel for spectrum channelCount 2", () => {
    const { container } = render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumDisplayLabel="L/R"
        onSpectrumChange={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders spectrum label for Spectrum and Spectrogram", () => {
    for (const activeTab of ["spectrum", "spectrogram"]) {
      const { unmount } = render(
        <PanelSettingsContent
          activeTab={activeTab}
          channelCount={6}
          spectrumOptions={[{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }]}
          spectrumValueKey="s-2"
          spectrumDisplayLabel="C"
          onSpectrumChange={vi.fn()}
        />
      );

      expect(screen.getByLabelText(`${activeTab} channel`)).toBeTruthy();
      expect(screen.getByText("C")).toBeTruthy();
      unmount();
    }
  });

  it("uses snapshot display label when provided by the caller", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumDisplayLabel="Historical L/R"
        onSpectrumChange={vi.fn()}
      />
    );

    expect(screen.getByText("Historical L/R")).toBeTruthy();
  });

  it("shows the panel's own channel label, not the global display label, per instance", () => {
    // Reproduces the multichannel bug: a second Spectrogram panel selects C, but the global
    // (first-panel) display label is still L+R. The chip must reflect this panel's own selection.
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[
          { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
          { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
        ]}
        spectrumValueKey="p-0-1"
        spectrumDisplayLabel="L+R"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrumChannel: { type: "single", ch: 2 } }}
        onPanelControlsChange={vi.fn()}
        onSpectrumChange={vi.fn()}
      />
    );

    expect(screen.getByText("C")).toBeTruthy();
    expect(screen.queryByText("L+R")).toBeNull();
  });

  it("calls vectorscope change with selected pair", () => {
    const onVectorscopeChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="vectorscope"
        channelCount={6}
        vectorscopeOptions={[
          { key: "0-1", label: "L/R", x: 0, y: 1 },
          { key: "0-2", label: "L/C", x: 0, y: 2 },
        ]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={onVectorscopeChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "vectorscope channel" }));
    fireEvent.click(screen.getByRole("option", { name: "L/C" }));

    expect(onVectorscopeChange).toHaveBeenCalledWith({ x: 0, y: 2 });
  });

  it("updates vectorscope mode and only shows Max hold for Polar Level", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "vectorscope",
      channelCount: 2,
      vectorscopeOptions: [{ key: "0-1", label: "L/R", x: 0, y: 1 }],
      vectorscopeValueKey: "0-1",
      vectorscopeDisplayLabel: "L/R",
      onVectorscopeChange: vi.fn(),
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    const { rerender } = render(<PanelSettingsContent {...props} />);

    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "vectorscope polar level max hold" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "vectorscope mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Polar Level" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ vectorscopeMode: "polarLevel" })
    );

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, vectorscopeMode: "polarLevel" }}
      />
    );
    fireEvent.click(screen.getByRole("switch", { name: "vectorscope polar level max hold" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ vectorscopePolarLevelMaxHold: true })
    );
  });

  it("orders vectorscope Mode before Channel pair before Max hold", () => {
    const { container } = render(
      <PanelSettingsContent
        activeTab="vectorscope"
        channelCount={2}
        vectorscopeOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={vi.fn()}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, vectorscopeMode: "polarLevel" }}
        onPanelControlsChange={vi.fn()}
      />
    );

    const text = container.textContent;
    expect(text.indexOf("Mode")).toBeLessThan(text.indexOf("Channel Pair"));
    expect(text.indexOf("Channel Pair")).toBeLessThan(text.indexOf("Max Hold"));
  });

  it("keeps vectorscope all-pairs options collapsed until opened", () => {
    render(
      <PanelSettingsContent
        activeTab="vectorscope"
        channelCount={6}
        vectorscopeOptions={[
          { key: "0-1", label: "L/R", x: 0, y: 1, group: "Common" },
          { key: "0-2", label: "L/C", x: 0, y: 2, group: "Common" },
          { key: "0-3", label: "L/LFE", x: 0, y: 3, group: "All pairs" },
        ]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "vectorscope channel" }));

    expect(screen.getByRole("option", { name: "L/C" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All pairs" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "L/LFE" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All pairs" }));

    expect(screen.getByRole("option", { name: "L/LFE" })).toBeTruthy();
  });

  it("does not show removed vectorscope display switches", () => {
    render(
      <PanelSettingsContent
        activeTab="vectorscope"
        channelCount={2}
        vectorscopeOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("switch", { name: "vectorscope trace hold" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "vectorscope m/s energy" })).toBeNull();
  });

  it("updates stereo map mode, channel pair, hold, speed, and smoothing", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "stereo-map",
      stereoMapPairOptions: [
        { key: "0-1", label: "L/R", x: 0, y: 1 },
        { key: "0-2", label: "L/C", x: 0, y: 2 },
      ],
      stereoMapPairValueKey: "0-1",
      stereoMapPairDisplayLabel: "L/R",
      onStereoMapPairChange: vi.fn(),
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    render(<PanelSettingsContent {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "stereo map mode" }));
    fireEvent.click(screen.getByRole("option", { name: "Correlation" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapMode: "correlation" })
    );

    fireEvent.click(screen.getByRole("button", { name: "stereo map channel" }));
    fireEvent.click(screen.getByRole("option", { name: "L/C" }));
    expect(props.onStereoMapPairChange).toHaveBeenCalledWith({ x: 0, y: 2 });
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapPair: { x: 0, y: 2 } })
    );

    fireEvent.click(screen.getByRole("switch", { name: "stereo map max hold" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapHold: true })
    );

    fireEvent.click(screen.getByRole("button", { name: "stereo map octave smoothing" }));
    fireEvent.click(screen.getByRole("option", { name: "1/3 oct" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapOctaveSmoothing: "1/3" })
    );
  });

  it("commits the stereo map speed on release, not on every change", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stereo-map"
        stereoMapPairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        stereoMapPairValueKey="0-1"
        stereoMapPairDisplayLabel="L/R"
        onStereoMapPairChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    // Speed is part of the Stereo Map analysis request key. A drag that committed every
    // intermediate value would mint a request key per step, and every abandoned key keeps a whole
    // history slab alive for the rest of the session.
    const speed = screen.getByLabelText("stereo map speed");
    fireEvent.change(speed, { target: { value: "70" } });
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(speed);
    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapSpeedPercent: 70 })
    );
  });

  it("commits the stereo map speed on keyboard release", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stereo-map"
        stereoMapPairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        stereoMapPairValueKey="0-1"
        stereoMapPairDisplayLabel="L/R"
        onStereoMapPairChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    // Holding an arrow key auto-repeats change events and fires one keyup at the end, so a
    // keyboard adjustment commits once -- the pointer path is not the only way to reach a slider.
    const speed = screen.getByLabelText("stereo map speed");
    fireEvent.change(speed, { target: { value: "51" } });
    fireEvent.change(speed, { target: { value: "52" } });
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.keyUp(speed);
    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stereoMapSpeedPercent: 52 })
    );
  });

  it("orders stereo map Mode before Channel pair before Max hold", () => {
    const { container } = render(
      <PanelSettingsContent
        activeTab="stereo-map"
        stereoMapPairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        stereoMapPairValueKey="0-1"
        stereoMapPairDisplayLabel="L/R"
        onStereoMapPairChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    const text = container.textContent;
    expect(text.indexOf("Mode")).toBeLessThan(text.indexOf("Channel Pair"));
    expect(text.indexOf("Channel Pair")).toBeLessThan(text.indexOf("Max Hold"));
    expect(text.indexOf("Max Hold")).toBeLessThan(text.indexOf("Speed"));
    expect(text.indexOf("Speed")).toBeLessThan(text.indexOf("Smoothing"));
    expect(text.indexOf("Smoothing")).toBeLessThan(text.indexOf("Frequency Range"));
  });

  it("shows a Level Range only for Mono Loss and M/S Ratio, with Mono Loss pinned at 0 dB", () => {
    const { rerender, container } = render(
      <PanelSettingsContent
        activeTab="stereo-map"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          stereoMapMode: "position",
        }}
        onPanelControlsChange={vi.fn()}
      />
    );
    expect(container.textContent).not.toContain("Level Range");

    rerender(
      <PanelSettingsContent
        activeTab="stereo-map"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          stereoMapMode: "monoLossDb",
          stereoMapMonoLossYMinDb: -24,
        }}
        onPanelControlsChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("stereo map mono loss level range min").value).toBe("-24");
    expect(screen.getByLabelText("stereo map mono loss level range max").value).toBe("0");

    rerender(
      <PanelSettingsContent
        activeTab="stereo-map"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          stereoMapMode: "msRatioDb",
          stereoMapMsRatioYMinDb: -48,
          stereoMapMsRatioYMaxDb: 24,
        }}
        onPanelControlsChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("stereo map m/s ratio level range min").value).toBe("-48");
    expect(screen.getByLabelText("stereo map m/s ratio level range max").value).toBe("24");
  });

  it("falls back to the first spectrum option when the value key is stale", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="s-99"
        spectrumDisplayLabel="Stale"
        onSpectrumChange={vi.fn()}
      />
    );

    expect(screen.getByText("L/R")).toBeTruthy();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("falls back to the first vectorscope option when the value key is stale", () => {
    render(
      <PanelSettingsContent
        activeTab="vectorscope"
        channelCount={6}
        vectorscopeOptions={[
          { key: "0-1", label: "L/R", x: 0, y: 1 },
          { key: "0-2", label: "L/C", x: 0, y: 2 },
        ]}
        vectorscopeValueKey="9-10"
        vectorscopeDisplayLabel="Stale"
        onVectorscopeChange={vi.fn()}
      />
    );

    expect(screen.getByText("L/R")).toBeTruthy();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("renders Stats metrics as an inline labeled detail and toggles stat ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Metrics")).toBeTruthy();
    expect(screen.getByText("VAD")).toBeTruthy();
    expect(
      screen.getByText("Metrics").compareDocumentPosition(screen.getByText("VAD")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("FireRedVAD")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Configure metrics" })).toBeNull();
    expect(screen.getByText("8 visible")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      statsVisibleIds: [
        "shortTerm",
        "integrated",
        "momentaryMax",
        "shortTermMax",
        "lra",
        "psr",
        "plr",
      ],
    });
  });

  it("renders the Stats VAD selector with official links and updates the selected engine", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("VAD")).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toContain("Voice activity detector");
    fireEvent.click(screen.getByRole("button", { name: "dialogue vad" }));

    expect(screen.getByRole("option", { name: /Silero VAD/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /FireRedVAD/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /TEN VAD/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Silero VAD official link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open FireRedVAD official link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open TEN VAD official link" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open TEN VAD official link" }));

    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/TEN-framework/ten-vad");
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("option", { name: /TEN VAD/ }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      dialogueVadEngine: "ten",
    });
  });

  it("offers no reference editor, since the active Loudness Profile owns that value", () => {
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Loudness reference")).toBeNull();
    expect(screen.queryByText("Ref")).toBeNull();
    // Layers, including the `ref` toggle, stay here.
    expect(screen.getByText("Layers")).toBeTruthy();
  });

  it("renders Loudness layers as an inline labeled detail and toggles layer ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.queryByText("Loudness")).toBeNull();
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Configure layers" })).toBeNull();
    const editButton = screen.getByRole("button", { name: "Edit layers" });
    // Off by default, so `ref` is not offered and must not be counted.
    expect(editButton.textContent).toContain("2 visible");
    fireEvent.click(editButton);
    const momentaryRow = screen.getByRole("checkbox", { name: "Momentary" });
    expect(momentaryRow.getAttribute("data-settings-option-row")).toBe("true");
    expect(momentaryRow.querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3"
    );
    expect(momentaryRow.className).toContain("py-0.5");
    expect(momentaryRow.className).not.toContain("py-1 ");
    expect(momentaryRow.className).not.toContain("py-1.5");
    expect(momentaryRow.className).toContain("var(--ui-fs-control)");
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
    });
  });

  it("counts only the layers it actually offers", () => {
    // Off filters `ref` out of the list; a summary that still counts it says "3 visible" over a
    // list of two, and the user has no way to find the third.
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    const editButton = screen.getByRole("button", { name: "Edit layers" });
    expect(editButton.textContent).toContain("2 visible");
    fireEvent.click(editButton);
    expect(screen.queryByRole("checkbox", { name: "Reference" })).toBeNull();
    expect(screen.getAllByRole("checkbox").length).toBe(2);
  });

  it("counts the ref layer once a profile supplies a reference", () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: profileSelectionId(TEST_PROFILE.id),
        profiles: [TEST_PROFILE],
      },
    });
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    const editButton = screen.getByRole("button", { name: "Edit layers" });
    expect(editButton.textContent).toContain("3 visible");
    fireEvent.click(editButton);
    expect(screen.getByRole("checkbox", { name: "Reference" })).toBeTruthy();
  });

  it("commits Loudness range changes", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(
      screen.getByText("Layers").compareDocumentPosition(screen.getByText("Loudness Range")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByLabelText("loudness range min").value).toBe("-64");
    expect(screen.getByLabelText("loudness range max").value).toBe("0");
    fireEvent.change(screen.getByLabelText("loudness range min"), {
      target: { value: "-48" },
    });
    fireEvent.change(screen.getByLabelText("loudness range max"), {
      target: { value: "-12" },
    });
    fireEvent.blur(screen.getByLabelText("loudness range max"));

    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessYMinDb: -48,
      loudnessYMaxDb: -12,
    });
  });

  it("renders stat rows in statsOrder", () => {
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          statsOrder: ["psr", "momentary", "integrated"],
        }}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0].getAttribute("data-settings-option-row")).toBe("true");
    expect(checkboxes[0].querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3"
    );
    expect(checkboxes.slice(0, 3).map((c) => c.textContent)).toEqual([
      "Short-term Dynamics",
      "Momentary",
      "Integrated",
    ]);
  });

  it("resets order and visibility to defaults after confirm", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          statsOrder: ["psr", "momentary", "integrated"],
          statsVisibleIds: ["psr"],
        }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset stats" }));
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Confirm reset stats"));
    expect(onPanelControlsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        statsOrder: STATS_CANONICAL_ORDER,
        statsVisibleIds: DEFAULT_PANEL_CONTROLS.statsVisibleIds,
      })
    );
  });

  it("shows the view toggle for a stereo spectrum panel", () => {
    const onSpectrumViewChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={onSpectrumViewChange}
      />
    );
    expect(screen.getByText("View")).toBeTruthy();
    expect(screen.getByLabelText("spectrum view")).toBeTruthy();
    expect(screen.getByLabelText("spectrum view").className).not.toContain("min-w-[");
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "spectrum view" }));
    fireEvent.click(screen.getByRole("option", { name: "M / S" }));
    expect(onSpectrumViewChange).toHaveBeenCalledWith("ms");
  });

  it("renders spectrum curve legend inside the view chip", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="ms"
        spectrumViewLegend={[
          { token: "primary", label: "M" },
          { token: "secondary", label: "S" },
        ]}
        onSpectrumViewChange={vi.fn()}
      />
    );

    const viewChip = screen.getByLabelText("spectrum view");
    expect(viewChip.contains(screen.getByText("M"))).toBe(true);
    expect(viewChip.contains(screen.getByText("S"))).toBe(true);
  });

  it("hides the view toggle when a single channel is selected", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={6}
        spectrumOptions={[{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }]}
        spectrumValueKey="s-2"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("spectrum view")).toBeNull();
  });

  it("hides the view toggle on the spectrogram tab (single heatmap can't overlay)", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="ms"
        onSpectrumViewChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("spectrum view")).toBeNull();
    // channel dropdown still available on the spectrogram tab
    expect(screen.getByLabelText("spectrogram channel")).toBeTruthy();
  });

  it("shows Max as one mode on spectrum, reflecting and changing the selection", () => {
    const onSpectrumMaxModeChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumMaxMode="decay"
        onSpectrumMaxModeChange={onSpectrumMaxModeChange}
      />
    );

    const trigger = screen.getByLabelText("spectrum max mode");
    expect(trigger.textContent).toContain("Decay");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Hold" }));

    expect(onSpectrumMaxModeChange).toHaveBeenCalledWith("hold");
  });

  it("shows compact spectrum display controls after Max", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumMaxMode="decay"
        onSpectrumMaxModeChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    const peak = screen.getByText("Max");
    const speed = screen.getByText("Speed");
    const tilt = screen.getByText("Tilt");
    const smoothing = screen.getByText("Smoothing");
    const xRange = screen.getByText("Frequency Range");
    const yRange = screen.getByText("Level Range");
    expect(peak.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(speed.compareDocumentPosition(tilt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tilt.compareDocumentPosition(smoothing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      smoothing.compareDocumentPosition(xRange) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(xRange.compareDocumentPosition(yRange) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const speedSlider = screen.getByLabelText("spectrum speed");
    const tiltSlider = screen.getByLabelText("spectrum tilt");
    expect(speedSlider).toBeTruthy();
    expect(tiltSlider).toBeTruthy();
    expect(speedSlider.classList.contains("plvs-range")).toBe(true);
    expect(speedSlider.style.getPropertyValue("--range-pct")).toBe("25%");
    expect(tiltSlider.classList.contains("plvs-range")).toBe(true);
    expect(tiltSlider.style.getPropertyValue("--range-pct")).toBe("50%");
    // Speed is a slider (time axis), Smoothing is a choice list (frequency axis). Confusing the
    // two is what this whole control layout exists to prevent, so pin that they stay distinct.
    expect(screen.getByLabelText("spectrum octave smoothing")).toBeTruthy();
    expect(screen.queryByLabelText("spectrum octave smoothing").tagName).not.toBe("INPUT");
    expect(screen.getByLabelText("spectrum frequency range min").value).toBe("20");
    expect(screen.getByLabelText("spectrum frequency range max").value).toBe("20000");
    expect(screen.getByLabelText("spectrum level range min").value).toBe("-96");
    expect(screen.getByLabelText("spectrum level range max").value).toBe("-12");
    expect(screen.getByLabelText("spectrum level range min").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("spectrum level range max").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("spectrum level range max").style.width).toBe("4.5ch");
    expect(screen.queryByText("50%")).toBeNull();
    expect(screen.queryByText("4.50 dB/oct")).toBeNull();
    expect(screen.queryByText("-12 dB")).toBeNull();
    expect(screen.queryByText("-96 dB")).toBeNull();
    expect(screen.queryByText("Speed: 50%")).toBeNull();
    expect(screen.queryByText("Tilt: 4.50 dB/oct")).toBeNull();
  });

  it("shows spectrum slider values on hover and focus", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumMaxMode="off"
        onSpectrumMaxModeChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    const speed = screen.getByLabelText("spectrum speed");
    fireEvent.mouseEnter(speed);
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.queryByText("Speed: 25%")).toBeNull();
    fireEvent.mouseLeave(speed);
    expect(screen.queryByText("25%")).toBeNull();

    const tilt = screen.getByLabelText("spectrum tilt");
    fireEvent.focus(tilt);
    expect(screen.getByText("3.00 dB/oct")).toBeTruthy();
    expect(screen.queryByText("Tilt: 3.00 dB/oct")).toBeNull();

    expect(screen.getByLabelText("spectrum level range min").value).toBe("-96");
    expect(screen.getByLabelText("spectrum level range max").value).toBe("-12");
  });

  it("commits spectrum display control changes", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumMaxMode="off"
        onSpectrumMaxModeChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    // Speed is part of the Spectrum analysis request key, so every intermediate value a drag
    // passes through would mint a request key of its own and strand a whole history slab. It
    // commits on release; the thumb and tooltip still track the drag.
    const speed = screen.getByLabelText("spectrum speed");
    fireEvent.change(speed, { target: { value: "42" } });
    expect(onPanelControlsChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(speed);
    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumSpeedPercent: 42,
    });

    // Tilt is not in the key -- it is applied on the render side -- so it commits per change and
    // the curve tracks the thumb.
    const tilt = screen.getByLabelText("spectrum tilt");
    fireEvent.change(tilt, { target: { value: "1.25" } });
    expect(onPanelControlsChange).toHaveBeenCalledTimes(2);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumTiltDbPerOctave: 1.25,
    });

    fireEvent.click(screen.getByLabelText("spectrum octave smoothing"));
    fireEvent.click(screen.getByRole("option", { name: /1\/3 oct/ }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumOctaveSmoothing: "1/3",
    });

    const xMin = screen.getByLabelText("spectrum frequency range min");
    const xMax = screen.getByLabelText("spectrum frequency range max");
    fireEvent.change(xMin, { target: { value: "100" } });
    fireEvent.change(xMax, { target: { value: "8000" } });
    fireEvent.blur(xMax);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumXMinFreq: 100,
      spectrumXMaxFreq: 8000,
    });

    const yMin = screen.getByLabelText("spectrum level range min");
    const yMax = screen.getByLabelText("spectrum level range max");
    fireEvent.change(yMin, { target: { value: "-84" } });
    fireEvent.change(yMax, { target: { value: "-24" } });
    fireEvent.blur(yMax);
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumYMinDb: -84,
      spectrumYMaxDb: -24,
    });
  });

  it("rounds range input display values and keeps enough room for negative digits", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumMaxMode="off"
        onSpectrumMaxModeChange={vi.fn()}
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          spectrumXMinFreq: 20.000001,
          spectrumXMaxFreq: 19999.999999,
          spectrumYMinDb: -64,
          spectrumYMaxDb: 0,
        }}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("spectrum frequency range min").value).toBe("20");
    expect(screen.getByLabelText("spectrum frequency range max").value).toBe("20000");
    expect(screen.getByLabelText("spectrum level range min").value).toBe("-64");
    expect(screen.getByLabelText("spectrum level range min").style.width).toBe("4.5ch");
  });

  it("hides the Peak toggle on the spectrogram tab", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumMaxMode="off"
        onSpectrumMaxModeChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("spectrum max decay")).toBeNull();
  });

  it("shows Tilt and Frequency Range, and nothing else, on the spectrogram tab", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );
    expect(screen.queryByLabelText("spectrum speed")).toBeNull();
    expect(screen.queryByLabelText("spectrum octave smoothing")).toBeNull();
    expect(screen.queryByLabelText("spectrum frequency range max")).toBeNull();
    expect(screen.queryByLabelText("spectrum level range max")).toBeNull();
    expect(screen.queryByLabelText("spectrum tilt")).toBeNull();
    expect(screen.getByLabelText("spectrogram frequency range min").value).toBe("20");
    expect(screen.getByLabelText("spectrogram frequency range max").value).toBe("20000");

    fireEvent.change(screen.getByLabelText("spectrogram frequency range min"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("spectrogram frequency range max"), {
      target: { value: "8000" },
    });
    fireEvent.blur(screen.getByLabelText("spectrogram frequency range max"));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrogramYMinFreq: 100,
      spectrogramYMaxFreq: 8000,
    });

    // Tilt shapes the spectrogram's colour mapping the way it shapes the curve, so the heatmap
    // carries it too -- through the ordered row list, so it sorts after Mode rather than above it.
    fireEvent.change(screen.getByLabelText("spectrogram tilt"), { target: { value: "4.5" } });
    expect(onPanelControlsChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumTiltDbPerOctave: 4.5,
    });
  });

  it("renders Spectrogram settings when only its range control is available", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={2}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(screen.getByText("Frequency Range")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram frequency range min").value).toBe("20");
    expect(screen.getByLabelText("spectrogram frequency range max").value).toBe("20000");
  });

  // Mode leads because it decides which of the rows below it even exist, and the three that apply
  // to every mode come before the ones a 3D mode adds.
  it("orders spectrogram Mode first, then the shared rows, then the 3D ones", () => {
    const { container } = render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "surface" }}
        onPanelControlsChange={vi.fn()}
      />
    );

    const text = container.textContent;
    const order = ["Mode", "Smoothing", "dB Floor", "Frequency Range", "Elevation", "Azimuth"];
    const at = order.map((label) => text.indexOf(label));
    for (const [i, index] of at.entries()) {
      expect({ label: order[i], found: index >= 0 }).toEqual({ label: order[i], found: true });
      if (i > 0)
        expect({ label: order[i], after: index > at[i - 1] }).toEqual({
          label: order[i],
          after: true,
        });
    }
  });

  it("shows the 3D sub-controls only while a 3D mode is selected", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "spectrogram",
      channelCount: 6,
      spectrumOptions: [{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }],
      spectrumValueKey: "p-0-1",
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    const { rerender } = render(<PanelSettingsContent {...props} />);

    expect(screen.getByRole("button", { name: "spectrogram mode" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "spectrogram 3d colorize" })).toBeNull();
    expect(screen.queryByLabelText("spectrogram 3d height scale")).toBeNull();
    expect(screen.queryByLabelText("spectrogram 3d elevation")).toBeNull();

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "lines" }}
      />
    );

    expect(screen.getByRole("switch", { name: "spectrogram 3d colorize" })).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d height scale")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d elevation")).toBeTruthy();
  });

  it("offers a reset only for whichever view angle has left its default", () => {
    const props = {
      activeTab: "spectrogram",
      channelCount: 6,
      spectrumOptions: [{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }],
      spectrumValueKey: "p-0-1",
      onPanelControlsChange: vi.fn(),
    };
    const { rerender } = render(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "lines" }}
      />
    );

    expect(screen.queryByRole("button", { name: "reset spectrogram 3d elevation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "reset spectrogram 3d azimuth" })).toBeNull();

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          spectrogramMode: "lines",
          spectrogram3dAzimuthDeg: 120,
        }}
      />
    );

    expect(screen.queryByRole("button", { name: "reset spectrogram 3d elevation" })).toBeNull();
    expect(screen.getByRole("button", { name: "reset spectrogram 3d azimuth" })).toBeTruthy();
  });

  it("resets one view angle at a time, leaving the other and every other control untouched", () => {
    const onPanelControlsChange = vi.fn();
    const customControls = {
      ...DEFAULT_PANEL_CONTROLS,
      spectrogramMode: "lines",
      spectrogram3dAzimuthDeg: 120,
      spectrogram3dElevationDeg: 5,
      spectrogram3dHeightGain: 2.5,
      spectrogram3dColorize: true,
      spectrogramYMinFreq: 100,
      spectrogramYMaxFreq: 8000,
    };
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        panelControls={customControls}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "reset spectrogram 3d elevation" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...customControls,
      spectrogram3dElevationDeg: DEFAULT_PANEL_CONTROLS.spectrogram3dElevationDeg,
    });
    let result = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(result.spectrogram3dElevationDeg).toBe(60);
    expect(result.spectrogram3dAzimuthDeg).toBe(120);
    expect(result.spectrogram3dHeightGain).toBe(2.5);
    expect(result.spectrogramYMinFreq).toBe(100);
    expect(result.spectrogramYMaxFreq).toBe(8000);

    fireEvent.click(screen.getByRole("button", { name: "reset spectrogram 3d azimuth" }));

    result = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(result.spectrogram3dAzimuthDeg).toBe(135);
    expect(result.spectrogram3dElevationDeg).toBe(5);
    expect(result.spectrogram3dColorize).toBe(true);
  });

  it("selects the spectrogram view mode and shows the 3D controls only in 3D", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "spectrogram",
      channelCount: 2,
      spectrumOptions: [{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }],
      spectrumValueKey: "p-0-1",
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    const { rerender } = render(<PanelSettingsContent {...props} />);

    // Heatmap is the default: no 3D control is present at all.
    expect(screen.queryByLabelText("spectrogram 3d elevation")).toBeNull();
    expect(screen.queryByLabelText("spectrogram 3d height scale")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "spectrogram mode" }));
    fireEvent.click(screen.getByRole("option", { name: "3D Surface" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ spectrogramMode: "surface" })
    );

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "surface" }}
      />
    );
    // The 3D view controls appear. Both 3D modes now show the same set -- the per-mode rows were
    // tuning controls and have been settled into constants.
    expect(screen.getByLabelText("spectrogram 3d elevation")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d height scale")).toBeTruthy();

    // The listbox marks "3D Surface" as the selected option, not just some other option.
    fireEvent.click(screen.getByRole("button", { name: "spectrogram mode" }));
    expect(screen.getByRole("option", { name: "3D Surface" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByRole("option", { name: "2D Heatmap" }).getAttribute("aria-selected")).toBe(
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "spectrogram mode" }));

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "lines" }}
      />
    );
    expect(screen.getByLabelText("spectrogram 3d elevation")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d height scale")).toBeTruthy();
  });

  it("does not render loudness controls before panel controls are wired", () => {
    const stats = render(<PanelSettingsContent activeTab="stats" />);
    expect(stats.container.firstChild).toBeNull();
    stats.unmount();

    const layers = render(<PanelSettingsContent activeTab="loudness" />);
    expect(layers.container.firstChild).toBeNull();
  });

  it("shows the frequency link control in a workspace panel's settings menu", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders value={{ panelControls: DEFAULT_PANEL_CONTROLS }}>
            <LeafView
              node={{ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }}
              path={[]}
            />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByRole("button", { name: "link frequency range" })).toBeTruthy();
  });

  it("shows the frequency link control in a fullscreen panel's settings menu", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
        panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
        panelOrder: ["spectrum"],
        panelControlsById: { spectrum: DEFAULT_PANEL_CONTROLS },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders value={{ panelControls: DEFAULT_PANEL_CONTROLS }}>
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Panel settings" }).at(-1));

    expect(screen.getByRole("button", { name: "link frequency range" })).toBeTruthy();
  });

  it("shows the time link control in a workspace timeline panel's settings menu", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              ...historyDataWithViewport(),
              histSourceList: [],
              selectedOffset: -1,
              setSelectedOffset: vi.fn(),
              running: false,
              hasHistoryData: false,
              referenceLufs: -23,
            }}
          >
            <LeafView
              node={{ type: "leaf", tabs: ["loudness"], activeTab: "loudness" }}
              path={[]}
            />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByRole("button", { name: "link time range" })).toBeTruthy();
  });

  it("shows the time link control in a fullscreen timeline panel's settings menu", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        panelsById: { loudness: { id: "loudness", moduleId: "loudness" } },
        panelOrder: ["loudness"],
        panelControlsById: { loudness: DEFAULT_PANEL_CONTROLS },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              ...historyDataWithViewport(),
              histSourceList: [],
              selectedOffset: -1,
              setSelectedOffset: vi.fn(),
              running: false,
              hasHistoryData: false,
              referenceLufs: -23,
            }}
          >
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Panel settings" }).at(-1));

    expect(screen.getByRole("button", { name: "link time range" })).toBeTruthy();
  });

  it("passes audio panel control changes through LeafView to the header controls", () => {
    const onState = vi.fn();

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <WorkspaceStateProbe onState={onState} />
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.panelControlsById.stats).toEqual({
      ...DEFAULT_PANEL_CONTROLS,
      statsVisibleIds: [
        "shortTerm",
        "integrated",
        "momentaryMax",
        "shortTermMax",
        "lra",
        "psr",
        "plr",
      ],
    });
  });

  it("pins the active panel size from the LeafView header", () => {
    const onState = vi.fn();
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <WorkspaceStateProbe onState={onState} />
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );
    const leafEl = container.querySelector("[data-leaf]");
    leafEl.getBoundingClientRect = () => ({ width: 320, height: 180 });

    const pinButton = screen.getByRole("button", { name: "Pin panel size" });
    expect(pinButton.querySelector("svg")?.getAttribute("class")).toContain(
      "size-[calc(var(--ui-icon-panel-action)*0.9)]"
    );

    fireEvent.click(pinButton);

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.pinnedPanelsById).toEqual({
      stats: { width: 320, height: 180 },
    });
    const unpinButton = screen.getByRole("button", { name: "Unpin panel size" });
    expect(unpinButton.querySelector("svg")?.getAttribute("class")).toContain(
      "size-[calc(var(--ui-icon-panel-action)*0.9)]"
    );
  });

  it("uses another tab's pinned size for the shared tab slot", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: {
          type: "split",
          direction: "h",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["spectrum", "waveform"], activeTab: "waveform" },
            { type: "leaf", tabs: ["stats"], activeTab: "stats" },
          ],
        },
        panelsById: {
          spectrum: { id: "spectrum", moduleId: "spectrum" },
          waveform: { id: "waveform", moduleId: "waveform" },
          stats: { id: "stats", moduleId: "stats" },
        },
        panelOrder: ["spectrum", "waveform", "stats"],
        panelControlsById: {
          spectrum: DEFAULT_PANEL_CONTROLS,
          waveform: DEFAULT_PANEL_CONTROLS,
          stats: DEFAULT_PANEL_CONTROLS,
        },
        pinnedPanelsById: { spectrum: { width: 360, height: 220 } },
      })
    );

    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    const leaves = container.querySelectorAll("[data-leaf]");
    expect(leaves[0].style.flex).toBe("0 0 360px");
    const slotPinButton = screen
      .getAllByRole("button", { name: "Pin panel size" })
      .find((button) => {
        fireEvent.mouseEnter(button);
        const isLocked = Boolean(screen.queryByText(/locked by Spectrum/));
        fireEvent.mouseLeave(button);
        return isLocked;
      });
    expect(slotPinButton).toBeTruthy();
  });

  it("locks both axes for a pinned panel that occupies its own column", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: {
          type: "split",
          direction: "h",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["stats"], activeTab: "stats" },
            { type: "leaf", tabs: ["stats-2"], activeTab: "stats-2" },
          ],
        },
        panelsById: {
          stats: { id: "stats", moduleId: "stats" },
          "stats-2": { id: "stats-2", moduleId: "stats" },
        },
        panelOrder: ["stats", "stats-2"],
        panelControlsById: {
          stats: DEFAULT_PANEL_CONTROLS,
          "stats-2": DEFAULT_PANEL_CONTROLS,
        },
        pinnedPanelsById: { stats: { width: 320, height: 180 } },
      })
    );

    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    const pinnedLeaf = container.querySelector("[data-leaf]");
    expect(pinnedLeaf.style.flex).toBe("0 0 320px");
    expect(pinnedLeaf.style.height).toBe("180px");
    expect(pinnedLeaf.style.alignSelf).toBe("flex-start");
  });

  it("uses the settings menu in the fullscreen header", () => {
    const onState = vi.fn();
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["stats"], activeTab: "stats" },
        panelsById: { stats: { id: "stats", moduleId: "stats" } },
        panelOrder: ["stats"],
        panelControlsById: { stats: DEFAULT_PANEL_CONTROLS },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <WorkspaceStateProbe onState={onState} />
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy();

    const settingsButtons = screen.getAllByRole("button", { name: "Panel settings" });
    fireEvent.click(settingsButtons.at(-1));
    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.panelControlsById.stats.statsVisibleIds).not.toContain("momentary");
  });

  it("preserves per-panel analysis status in fullscreen", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
        panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
        panelOrder: ["spectrum"],
        panelControlsById: { spectrum: DEFAULT_PANEL_CONTROLS },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              analysisStatusByPanelId: { spectrum: "overCap" },
              selectedOffset: -1,
            }}
          >
            <PanelChromeProvider value={{ analysisStatusByPanelId: { spectrum: "overCap" } }}>
              <SplitLayout />
            </PanelChromeProvider>
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.getAllByText("Too many active analysis views")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    expect(screen.getAllByText("Too many active analysis views")).toHaveLength(2);
  });

  it("uses a compact title bar for normal workspace panels", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    const titleBar = container.querySelector("[data-leaf-tabs]");
    const tabPill = container.querySelector("[data-tab-pill]");
    const titleGroup = container.querySelector("[data-panel-title-group]");

    expect(titleBar?.className).toContain("h-7");
    expect(titleBar?.className).not.toContain("h-9");
    expect(titleGroup?.className).toContain("px-1");
    expect(titleGroup?.className).not.toContain("px-2");
    expect(tabPill?.querySelector("[data-panel-title-icon]")).toBeTruthy();
  });

  it("hides the per-tab close control when a slot has only one tab", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    // A single-tab slot is already covered by the leaf header's "Hide all in panel" X.
    expect(screen.queryByRole("button", { name: "Close Stats" })).toBeNull();
  });

  it("closes just the clicked tab from a shared slot, leaving its sibling in place", () => {
    const onState = vi.fn();
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <WorkspaceStateProbe onState={onState} />
            <LeafView
              node={{ type: "leaf", tabs: ["stats", "spectrum"], activeTab: "spectrum" }}
              path={[]}
            />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Stats" }));

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.panelsById.stats).toBeUndefined();
    expect(latestState.panelsById.spectrum).toBeDefined();
    // Down to one tab: its own close control disappears too, per the same rule.
    expect(screen.queryByRole("button", { name: "Close Spectrum" })).toBeNull();
  });

  it("uses the same compact title bar density in fullscreen", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["stats"], activeTab: "stats" },
        panelsById: { stats: { id: "stats", moduleId: "stats" } },
        panelOrder: ["stats"],
        panelControlsById: { stats: DEFAULT_PANEL_CONTROLS },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    const exitButton = screen.getByRole("button", { name: "Exit fullscreen" });
    const titleBar = exitButton.parentElement?.parentElement;
    const titleGroup = titleBar?.querySelector("[data-panel-title-group]");

    expect(titleBar?.querySelector("[data-panel-title-icon]")).toBeTruthy();
    expect(titleGroup?.className).toContain("px-1");
    expect(titleBar?.className).toContain("h-7");
    expect(titleBar?.className).toContain("px-1");
    expect(titleBar?.className).toContain("var(--ui-fs-control)");
    expect(titleBar?.className).not.toContain("h-9");
    expect(titleBar?.className).not.toContain("px-3");
    expect(titleBar?.className).not.toContain("text-sm");
    expect(exitButton.className).toContain("p-0.5");
    expect(exitButton.className).not.toContain("p-1");
  });

  it("hides LeafView panel controls in compact panel mode", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              compactPanels: true,
              panelControls: DEFAULT_PANEL_CONTROLS,
              targetLufs: -23,
              referenceLufs: -23,
              hasHistoryData: false,
              historyChartInteractive: false,
              running: false,
              setSelectedOffset: vi.fn(),
              holdHistoryHud: vi.fn(),
              showHistoryHud: vi.fn(),
              onHistoryWheel: vi.fn(),
              onHistoryPointerDown: vi.fn(),
              onHistoryPointerMove: vi.fn(),
              onHistoryPointerUp: vi.fn(),
              selectedOffset: -1,
              showSelLine: false,
              selLineX: 0,
              isHistoryHudVisible: false,
              clampedWindowSec: 30,
              effectiveOffsetSec: 0,
              historyTimeTicks: ["0s", "15s", "30s"],
              histSourceList: [],
              effectiveOffsetSamples: 0,
              visibleSamples: 0,
            }}
          >
            <PanelChromeProvider value={{ compactPanels: true }}>
              <LeafView
                node={{ type: "leaf", tabs: ["loudness"], activeTab: "loudness" }}
                path={[]}
              />
            </PanelChromeProvider>
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(container.querySelector("[data-leaf-tabs]")).toBeNull();
    expect(container.querySelector("[data-leaf-body]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Panel settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pin panel size" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide all in panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });

  it("places chart help in the LeafView header after panel settings", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              targetLufs: -23,
              referenceLufs: -23,
              hasHistoryData: false,
              historyChartInteractive: false,
              running: false,
              setSelectedOffset: vi.fn(),
              holdHistoryHud: vi.fn(),
              showHistoryHud: vi.fn(),
              onHistoryWheel: vi.fn(),
              onHistoryPointerDown: vi.fn(),
              onHistoryPointerMove: vi.fn(),
              onHistoryPointerUp: vi.fn(),
              selectedOffset: -1,
              showSelLine: false,
              selLineX: 0,
              isHistoryHudVisible: false,
              clampedWindowSec: 30,
              effectiveOffsetSec: 0,
              historyTimeTicks: ["0s", "15s", "30s"],
              histSourceList: [],
              effectiveOffsetSamples: 0,
              visibleSamples: 0,
            }}
          >
            <LeafView
              node={{ type: "leaf", tabs: ["loudness"], activeTab: "loudness" }}
              path={[]}
            />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    const labels = Array.from(
      container.querySelector("[data-leaf-tabs]").querySelectorAll("button")
    )
      .map((button) => button.getAttribute("aria-label"))
      .filter(Boolean);

    expect(labels).toEqual([
      "Panel settings",
      "Shortcuts and gestures",
      "Pin panel size",
      "Fullscreen",
      "Hide all in panel",
    ]);
  });

  it("shows Level Meter axis gestures in chart help, without a Markers section by default", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              displayAudio: { peakDb: [-9.9, -10] },
              peakLabelContext: { resolvedLayout: "stereo" },
              hasTpMaxValue: false,
            }}
          >
            <LeafView
              node={{ type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" }}
              path={[]}
            />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Shortcuts and gestures" }));

    expect(screen.getByText("Level axis wheel - Zoom level")).toBeTruthy();
    expect(screen.getByText("Level axis drag - Pan level")).toBeTruthy();
    expect(screen.getByText("Double-click axis - Reset axis")).toBeTruthy();
    // Off by default (DEFAULT_PANEL_CONTROLS.levelMeterTpMaxMarker is false), so the marker the
    // popover would document isn't on the panel.
    expect(screen.queryByText("Click marker - Reset TP Max")).toBeNull();
  });

  it("adds the TP Max Markers section only in Peak mode with the marker switched on", () => {
    // resolveLevelMeterHelp reads the panel's *stored* controls (via LeafView's
    // getPanelControls), not the TestPanelDataProviders value used by the panel body -- so the
    // switch has to be seeded into the workspace state itself, the same way the other
    // panelControlsById tests in this file do it.
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        tree: { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
        panelsById: { levelMeter: { id: "levelMeter", moduleId: "levelMeter" } },
        panelOrder: ["levelMeter"],
        panelControlsById: {
          levelMeter: { ...DEFAULT_PANEL_CONTROLS, levelMeterTpMaxMarker: true },
        },
      })
    );

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: { ...DEFAULT_PANEL_CONTROLS, levelMeterTpMaxMarker: true },
              displayAudio: { peakDb: [-9.9, -10] },
              peakLabelContext: { resolvedLayout: "stereo" },
              hasTpMaxValue: false,
            }}
          >
            <SplitLayout />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Shortcuts and gestures" }));

    expect(screen.getByText("Click marker - Reset TP Max")).toBeTruthy();
    expect(
      screen
        .getByText("Double-click axis - Reset axis")
        .compareDocumentPosition(screen.getByText("Click marker - Reset TP Max"))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("passes compact panel mode into the active timeline panel body", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              compactPanels: true,
              panelControls: DEFAULT_PANEL_CONTROLS,
              historyYAxisTicks: [
                { v: -12, lb: "-12" },
                { v: -23, lb: "-23" },
                { v: -36, lb: "-36" },
              ],
              targetLufs: -23,
              referenceLufs: -23,
              hasHistoryData: true,
              historyChartInteractive: false,
              running: false,
              setSelectedOffset: vi.fn(),
              holdHistoryHud: vi.fn(),
              showHistoryHud: vi.fn(),
              onHistoryWheel: vi.fn(),
              onHistoryPointerDown: vi.fn(),
              onHistoryPointerMove: vi.fn(),
              onHistoryPointerUp: vi.fn(),
              displayHistoryPathM: "",
              displayHistoryPathST: "",
              selectedOffset: -1,
              showSelLine: false,
              selLineX: 0,
              isHistoryHudVisible: false,
              clampedWindowSec: 30,
              effectiveOffsetSec: 0,
              historyTimeTicks: ["0s", "15s", "30s"],
              histSourceList: [],
              effectiveOffsetSamples: 0,
              visibleSamples: 0,
            }}
          >
            <PanelChromeProvider value={{ compactPanels: true }}>
              <LeafView
                node={{ type: "leaf", tabs: ["loudness"], activeTab: "loudness" }}
                path={[]}
              />
            </PanelChromeProvider>
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });

  it("does not render a remove button beside the panel tab title", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <TestPanelDataProviders
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </TestPanelDataProviders>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.getAllByText("Stats").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Remove Stats")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide all in panel" })).toBeTruthy();
  });
});
