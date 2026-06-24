/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { DEFAULT_PANEL_CONTROLS } from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "@/lib/statsCatalog.js";
import { AudioDataContext } from "@/workspace/AudioDataContext.jsx";
import { DragProvider } from "@/workspace/DragContext.jsx";
import { LeafView } from "@/workspace/LeafView.jsx";
import { SplitLayout } from "@/workspace/SplitLayout.jsx";
import { WorkspaceProvider, useWorkspaceStore } from "@/workspace/WorkspaceContext.jsx";

vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children, role, "aria-label": ariaLabel, className }) => (
      <div role={role} aria-label={ariaLabel} className={className}>
        {children}
      </div>
    ),
    Item: ({ children, className }) => <div className={className}>{children}</div>,
  },
  useDragControls: () => ({ start: () => {} }),
}));

beforeEach(() => {
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
  it("renders Level Meter mode as a labeled settings row and updates mode", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Mode")).toBeTruthy();
    const modeButton = screen.getByLabelText("level meter mode");
    const modeRow = screen.getByText("Mode").parentElement;
    expect(modeButton).toBeTruthy();
    expect(modeButton.className).toContain("h-6");
    expect(modeButton.className).toContain("text-popover-foreground");
    expect(modeButton.className).not.toContain("text-muted-foreground");
    expect(modeButton.className).not.toContain("h-7");
    expect(modeButton.className).not.toContain("min-w-[");
    expect(screen.getByText("Mode").className).toContain("text-muted-foreground");
    expect(screen.getByText("Mode").className).not.toContain("text-popover-foreground");
    expect(modeRow?.className).toContain("min-h-6");
    expect(modeRow?.className).toContain("gap-2");
    expect(modeRow?.className).not.toContain("min-h-7");
    expect(modeRow?.className).not.toContain("gap-4");
    expect(screen.getByText("Peak")).toBeTruthy();

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "level meter mode" }));
    const peakOption = screen.getByRole("option", { name: "Peak" });
    expect(peakOption.querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3.5"
    );
    expect(peakOption.querySelector("svg")?.className.baseVal).toContain("size-3");
    const momentaryOption = screen.getByRole("option", { name: "M" });
    expect(momentaryOption.getAttribute("data-settings-option-row")).toBe("true");
    expect(momentaryOption.querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3.5"
    );
    fireEvent.click(momentaryOption);

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
    });
  });

  it("hides the Level Meter value marker switch in Peak mode", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.queryByText("Value marker")).toBeNull();
    expect(screen.queryByRole("switch", { name: "level meter value marker" })).toBeNull();
  });

  it("renders the Level Meter value marker switch for Momentary and updates it", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="levelMeter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Value marker")).toBeTruthy();
    const switchButton = screen.getByRole("switch", { name: "level meter value marker" });
    expect(switchButton.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(switchButton);

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
      levelMeterValueMarker: false,
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
    fireEvent.click(screen.getByRole("option", { name: "ST" }));

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

  it("renders Stats metrics as a secondary configure popover and toggles stat ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByText("Metrics")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configure metrics" }));
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

  it("renders Layers chip and toggles layer ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.queryByText("Loudness")).toBeNull();
    expect(screen.getByText("Layers").className).toContain("text-xs");
    const configureButton = screen.getByRole("button", { name: "Configure layers" });
    expect(configureButton.className).toContain("h-6");
    expect(configureButton.className).not.toContain("h-7");
    fireEvent.click(configureButton);
    expect(document.querySelector('[data-slot="popover-content"]').className).not.toContain(
      "min-w-[12rem]"
    );
    const momentaryRow = screen.getByRole("checkbox", { name: "Momentary" });
    expect(momentaryRow.getAttribute("data-settings-option-row")).toBe("true");
    expect(momentaryRow.querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3.5"
    );
    expect(momentaryRow.className).toContain("py-0.5");
    expect(momentaryRow.className).not.toContain("py-1 ");
    expect(momentaryRow.className).not.toContain("py-1.5");
    expect(momentaryRow.className).toContain("text-xs");
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
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

    fireEvent.click(screen.getByRole("button", { name: "Configure metrics" }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0].getAttribute("data-settings-option-row")).toBe("true");
    expect(checkboxes[0].querySelector("[data-settings-option-check]")?.className).toContain(
      "size-3.5"
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

    fireEvent.click(screen.getByRole("button", { name: "Configure metrics" }));
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

  it("shows Peak hold as a switch on spectrum and reflects + flips state", () => {
    const onSpectrumPeakHoldToggle = vi.fn();
    render(
      <PanelSettingsContent
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
        spectrumPeakHold={true}
        onSpectrumPeakHoldToggle={onSpectrumPeakHoldToggle}
      />
    );
    const btn = screen.getByRole("switch", { name: "peak hold" });
    expect(btn.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(btn);
    expect(onSpectrumPeakHoldToggle).toHaveBeenCalledTimes(1);
  });

  it("hides the Peak toggle on the spectrogram tab", () => {
    render(
      <PanelSettingsContent
        activeTab="spectrogram"
        channelCount={6}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumPeakHold={false}
        onSpectrumPeakHoldToggle={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("peak hold")).toBeNull();
  });

  it("does not render loudness controls before panel controls are wired", () => {
    const stats = render(<PanelSettingsContent activeTab="stats" />);
    expect(stats.container.firstChild).toBeNull();
    stats.unmount();

    const layers = render(<PanelSettingsContent activeTab="loudness" />);
    expect(layers.container.firstChild).toBeNull();
  });

  it("passes audio panel control changes through LeafView to the header controls", () => {
    const onState = vi.fn();

    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <AudioDataContext.Provider
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              statsMetrics: [],
            }}
          >
            <WorkspaceStateProbe onState={onState} />
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure metrics" }));
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
        <AudioDataContext.Provider
          value={{
            panelControls: DEFAULT_PANEL_CONTROLS,
            statsMetrics: [],
          }}
        >
          <WorkspaceStateProbe onState={onState} />
          <SplitLayout />
        </AudioDataContext.Provider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy();

    const settingsButtons = screen.getAllByRole("button", { name: "Panel settings" });
    fireEvent.click(settingsButtons.at(-1));
    fireEvent.click(screen.getByRole("button", { name: "Configure metrics" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.panelControlsById.stats.statsVisibleIds).not.toContain("momentary");
  });

  it("uses a compact title bar for normal workspace panels", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <AudioDataContext.Provider
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              fmt: (value) => value.toFixed(1),
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    const titleBar = container.querySelector("[data-leaf-tabs]");
    const tabPill = container.querySelector("[data-tab-pill]");
    const titleGroup = container.querySelector("[data-panel-title-group]");

    expect(titleBar?.className).toContain("h-7");
    expect(titleBar?.className).not.toContain("h-9");
    expect(tabPill?.className).toContain("px-1");
    expect(tabPill?.className).not.toContain("px-2");
    expect(titleGroup?.className).toContain("px-1");
    expect(tabPill?.querySelector("[data-panel-title-icon]")).toBeTruthy();
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
        <AudioDataContext.Provider
          value={{
            panelControls: DEFAULT_PANEL_CONTROLS,
            statsMetrics: [],
          }}
        >
          <SplitLayout />
        </AudioDataContext.Provider>
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
    expect(titleBar?.className).toContain("text-xs");
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
          <AudioDataContext.Provider
            value={{
              compactPanels: true,
              panelControls: DEFAULT_PANEL_CONTROLS,
              fmt: (value) => value.toFixed(1),
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(container.querySelector("[data-leaf-tabs]")).toBeNull();
    expect(container.querySelector("[data-leaf-body]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Panel settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide all in panel" })).toBeNull();
  });

  it("passes compact panel mode into the active timeline panel body", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <AudioDataContext.Provider
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
              setStatus: vi.fn(),
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
            <LeafView
              node={{ type: "leaf", tabs: ["loudness"], activeTab: "loudness" }}
              path={[]}
            />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });

  it("does not render a remove button beside the panel tab title", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <AudioDataContext.Provider
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              fmt: (value) => value.toFixed(1),
              statsMetrics: [],
            }}
          >
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.getAllByText("Stats").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Remove Stats")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide all in panel" })).toBeTruthy();
  });
});
