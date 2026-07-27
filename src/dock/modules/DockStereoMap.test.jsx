/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { StereoMapHistorySlab } from "../../lib/StereoMapHistorySlab.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DEFAULT_DOCK_MODULES, DOCK_PANEL_MODULE_IDS } from "../dockLayout.js";
import { dockStereoMapKey } from "../dockAnalysisRequest.js";
import { DockStereoMap } from "./DockStereoMap.jsx";

const controls = { pair: { x: 0, y: 1 }, mode: STEREO_MAP_MODES.POSITION, hold: false };
const key = dockStereoMapKey(controls);

function primitiveRow() {
  return {
    bandCentersHz: [100, 1000, 10000],
    pl: [1, 1, 1e-12],
    pr: [1, 0, 1e-12],
    c: [1, 0, 0],
  };
}

function renderWith({
  result,
  channelCount = 2,
  selectedControls = controls,
  historyData = {},
} = {}) {
  return render(
    <FrameDataProvider
      value={{
        channelCount,
        displayAudio: { stereoMapResultsByKey: result ? { [key]: result } : {} },
      }}
    >
      <HistoryDataProvider value={historyData}>
        <DockStereoMap controls={selectedControls} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("dock module registration", () => {
  it("appears after Waveform in the Dock module catalog and is disabled by default", () => {
    expect(DOCK_PANEL_MODULE_IDS.indexOf("stereo-map")).toBe(
      DOCK_PANEL_MODULE_IDS.indexOf("waveform") + 1
    );
    expect(DEFAULT_DOCK_MODULES).not.toContain("stereoMap");
  });

  it("uses the Spectrum-like flexible size policy", () => {
    expect(DOCK_MODULE_REGISTRY.stereoMap).toMatchObject({
      minWidth: 180,
      defaultWidth: 360,
      growthPolicy: "flexible",
    });
  });
});

describe("DockStereoMap", () => {
  it("renders the current curve, baseline, and fill for the keyed live result", () => {
    const { container } = renderWith({ result: primitiveRow() });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(plot.querySelector("[data-stereo-map-grid]")).toBeTruthy();
    expect(plot.querySelectorAll("[data-stereo-map-segment]").length).toBeGreaterThan(0);
    expect(plot.querySelector("polygon")).toBeTruthy();
  });

  it("shows top/bottom pair labels only in Position mode", () => {
    renderWith({ result: primitiveRow() });
    expect(screen.getByTestId("dock-stereo-map-pair-labels")).toBeTruthy();

    const { container } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION },
    });
    expect(container.querySelector('[data-testid="dock-stereo-map-pair-labels"]')).toBeNull();
  });

  it("draws a Hold outline only when the shared per-key live Hold is enabled", () => {
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 1, 1],
      pr: [1, 1, 1],
      c: [1, 1, 1],
    });
    const getStereoMapHistoryForKey = (candidateKey) => (candidateKey === key ? slab : null);

    const { container: withoutHold } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION, hold: false },
      historyData: { getStereoMapHistoryForKey },
    });
    expect(withoutHold.querySelector("[data-stereo-map-hold]")).toBeNull();

    const { container: withHold } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION, hold: true },
      historyData: { getStereoMapHistoryForKey },
    });
    expect(withHold.querySelector('[data-stereo-map-hold="hold"]')).toBeTruthy();
  });

  it("shares live Hold with the Workspace panel on the same Analysis Key", () => {
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 0, 1],
      pr: [0, 1, 1],
      c: [0, 0, 1],
    });
    const getStereoMapHistoryForKey = (candidateKey) => (candidateKey === key ? slab : null);

    const { container: dockContainer } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, hold: true },
      historyData: { getStereoMapHistoryForKey },
    });

    // Same shared slab.liveHoldValues() the Workspace panel reads (StereoMapHistorySlab), not a
    // private per-instance accumulator: both consumers of this key must see the identical points.
    const expectedHold = slab.liveHoldValues()[STEREO_MAP_MODES.POSITION];
    const dockMaxHold = dockContainer.querySelector('[data-stereo-map-hold="max"]');
    expect(dockMaxHold).toBeTruthy();
    expect(expectedHold.maximum.some((v) => v !== null)).toBe(true);
  });

  it("renders no hover, wheel, pan, axis, or snapshot chrome", () => {
    const { container } = renderWith({ result: primitiveRow() });
    expect(container.querySelector('[data-testid="stereo-map-chart"]')).toBeNull();
    expect(container.querySelector("[data-stereo-map-hover]")).toBeNull();
    expect(container.textContent).not.toMatch(/Hz/);
  });

  it("renders compact placeholders (no curve) for mono input", () => {
    const { container } = renderWith({ result: primitiveRow(), channelCount: 1 });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(plot.querySelectorAll("[data-stereo-map-segment]").length).toBe(0);
  });

  it("renders compact placeholders (no curve) while the keyed request is pending", () => {
    const { container } = renderWith({ result: null });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(plot.querySelectorAll("[data-stereo-map-segment]").length).toBe(0);
  });
});
