/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PanelHeaderControls } from "./PanelHeaderControls.jsx";
import { DEFAULT_PANEL_CONTROLS, LOUDNESS_STATS_ORDER } from "@/lib/panelControls.js";
import { AudioDataContext } from "@/workspace/AudioDataContext.jsx";
import { DragProvider } from "@/workspace/DragContext.jsx";
import { LeafView } from "@/workspace/LeafView.jsx";
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
});

function WorkspaceStateProbe({ onState }) {
  const { state } = useWorkspaceStore();
  onState(state);
  return null;
}

describe("PanelHeaderControls", () => {
  it("renders Level Meter mode chip and updates mode", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="peak"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    expect(screen.getByLabelText("level meter mode")).toBeTruthy();
    expect(screen.getByLabelText("level meter mode").className).toContain("focus-visible:ring-0");
    expect(screen.getByText("Peak")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "M" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
    });
  });

  it("selects Short-term from the Level Meter mode chip", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="peak"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "ST" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "shortTerm",
    });
  });

  it("does not render channel controls below multichannel for spectrum channelCount 2", () => {
    const { container } = render(
      <PanelHeaderControls
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
        <PanelHeaderControls
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
      <PanelHeaderControls
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

  it("calls vectorscope change with selected pair", () => {
    const onVectorscopeChange = vi.fn();
    render(
      <PanelHeaderControls
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

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "L/C" }));

    expect(onVectorscopeChange).toHaveBeenCalledWith({ x: 0, y: 2 });
  });

  it("falls back to the first spectrum option when the value key is stale", () => {
    render(
      <PanelHeaderControls
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
      <PanelHeaderControls
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

  it("renders Stats chip and toggles stat ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessStatsVisibleIds: [
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
      <PanelHeaderControls
        activeTab="loudness"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
    });
  });

  it("renders stat rows in loudnessStatsOrder", () => {
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          loudnessStatsOrder: ["psr", "momentary", "integrated"],
        }}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.slice(0, 3).map((c) => c.textContent)).toEqual([
      "Short-term Dynamics",
      "Momentary",
      "Integrated",
    ]);
  });

  it("resets order and visibility to defaults after confirm", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          loudnessStatsOrder: ["psr", "momentary", "integrated"],
          loudnessStatsVisibleIds: ["psr"],
        }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset stats" }));
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Confirm reset stats"));
    expect(onPanelControlsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        loudnessStatsOrder: LOUDNESS_STATS_ORDER,
        loudnessStatsVisibleIds: DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds,
      })
    );
  });

  it("shows the view toggle for a stereo spectrum panel", () => {
    render(
      <PanelHeaderControls
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumView="combined"
        onSpectrumViewChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("spectrum view")).toBeTruthy();
  });

  it("renders spectrum curve legend inside the view chip", () => {
    render(
      <PanelHeaderControls
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
      <PanelHeaderControls
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
      <PanelHeaderControls
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

  it("shows the Peak toggle on spectrum and reflects + flips state", () => {
    const onSpectrumPeakHoldToggle = vi.fn();
    render(
      <PanelHeaderControls
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
    const btn = screen.getByLabelText("peak hold");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onSpectrumPeakHoldToggle).toHaveBeenCalledTimes(1);
  });

  it("hides the Peak toggle on the spectrogram tab", () => {
    render(
      <PanelHeaderControls
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
    const stats = render(<PanelHeaderControls activeTab="loudnessStats" />);
    expect(stats.container.firstChild).toBeNull();
    stats.unmount();

    const layers = render(<PanelHeaderControls activeTab="loudness" />);
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
            <LeafView
              node={{ type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" }}
              path={[]}
            />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Momentary" }));

    const latestState = onState.mock.calls.at(-1)?.[0];
    expect(latestState.panelControlsById.loudnessStats).toEqual({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessStatsVisibleIds: [
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
            <LeafView
              node={{ type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" }}
              path={[]}
            />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(container.querySelector("[data-leaf-tabs]")).toBeNull();
    expect(container.querySelector("[data-leaf-body]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide all in panel" })).toBeNull();
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
            <LeafView
              node={{ type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" }}
              path={[]}
            />
          </AudioDataContext.Provider>
        </DragProvider>
      </WorkspaceProvider>
    );

    expect(screen.getByText("Loudness Stats")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Loudness Stats")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide all in panel" })).toBeTruthy();
  });
});
