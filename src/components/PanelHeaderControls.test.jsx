/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PanelHeaderControls } from "./PanelHeaderControls.jsx";
import { DEFAULT_PANEL_CONTROLS } from "@/lib/panelControls.js";
import { AudioDataContext } from "@/workspace/AudioDataContext.jsx";
import { DragProvider } from "@/workspace/DragContext.jsx";
import { LeafView } from "@/workspace/LeafView.jsx";
import { WorkspaceProvider } from "@/workspace/WorkspaceContext.jsx";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("PanelHeaderControls", () => {
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
      loudnessStatsVisibleIds: ["shortTerm", "integrated", "lra"],
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
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref", "momentary"],
    });
  });

  it("does not render loudness controls before panel controls are wired", () => {
    const stats = render(<PanelHeaderControls activeTab="loudnessStats" />);
    expect(stats.container.firstChild).toBeNull();
    stats.unmount();

    const layers = render(<PanelHeaderControls activeTab="loudness" />);
    expect(layers.container.firstChild).toBeNull();
  });

  it("passes audio panel controls through LeafView to the header controls", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <AudioDataContext.Provider
            value={{
              panelControls: DEFAULT_PANEL_CONTROLS,
              onPanelControlsChange: vi.fn(),
              primaryMetrics: [],
              secondaryMetrics: [],
              histCurves: {},
              toggleCurve: vi.fn(),
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

    expect(screen.getByRole("button", { name: "Stats" })).toBeTruthy();
  });
});
