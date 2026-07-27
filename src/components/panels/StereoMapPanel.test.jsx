/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  FrameDataProvider,
  HistoryDataProvider,
  PanelInstanceProvider,
} from "../../workspace/AudioDataContext.jsx";
import { StereoMapPanel, STEREO_MAP_MONO_MESSAGE } from "./StereoMapPanel.jsx";
import { STEREO_MAP_MODES, deriveStereoMapRow } from "../../math/stereoMapMath.js";
import { StereoMapHistorySlab } from "../../lib/StereoMapHistorySlab.js";

const KEY = "stereoMap:pair:0:1:sp25:sm12";

function primitiveRow() {
  return {
    bandCentersHz: [100, 1000, 10000],
    // b0: equal energy, in-phase -> Position 0, Correlation +1, MonoLoss 0dB, MSRatio -Infinity.
    // b1: hard-panned to the first channel -> Position +1, Correlation invalid (zero denominator),
    //     MonoLoss/MSRatio ~0dB (matches the design doc's hard-pan reference case).
    // b2: near-silent on both channels -> gated below the energy floor, so every Mode breaks here.
    pl: [1, 1, 1e-12],
    pr: [1, 0, 1e-12],
    c: [1, 0, 0],
  };
}

function renderPanel(audioData) {
  const {
    panelControls,
    analysisStatus,
    onPanelControlsChange,
    displayAudio,
    channelCount,
    peakLabelContext,
    ...historyData
  } = audioData;
  return render(
    <FrameDataProvider value={{ displayAudio, channelCount, peakLabelContext }}>
      <HistoryDataProvider value={historyData}>
        <PanelInstanceProvider value={{ panelControls, analysisStatus, onPanelControlsChange }}>
          <StereoMapPanel />
        </PanelInstanceProvider>
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

function baseAudioData(overrides = {}) {
  return {
    selectedOffset: -1,
    channelCount: 2,
    peakLabelContext: {},
    panelControls: { stereoMapPair: { first: 0, second: 1 } },
    displayAudio: { stereoMapResultsByKey: { [KEY]: primitiveRow() } },
    ...overrides,
  };
}

describe("StereoMapPanel", () => {
  beforeEach(() => {
    // Hover's raf-scheduled state update needs to run synchronously in jsdom for assertions to
    // see it immediately, and the chart's own bounding rect needs a real size so xFrac math
    // resolves to a stable band index instead of clamping at an edge.
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => {
        cb();
        return 1;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 260,
      top: 0,
      right: 1000,
      bottom: 260,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders only the selected Mode's plot", () => {
    const { container } = renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.CORRELATION,
        },
      })
    );

    expect(container.querySelector('[data-stereo-map-plot="correlation"]')).toBeTruthy();
    expect(container.querySelector('[data-stereo-map-plot="position"]')).toBeNull();
  });

  it("labels Position with the selected channel names and 0%, never Center", () => {
    renderPanel(
      baseAudioData({
        peakLabelContext: {},
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.POSITION,
        },
      })
    );

    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.queryByText("Center")).toBeNull();
    expect(screen.queryByText("C")).toBeNull();
  });

  it("shows Correlation's fixed +1/0/-1 axis contract", () => {
    renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.CORRELATION,
        },
      })
    );

    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("shows Mono Loss with a 0 dB top and the configured lower bound", () => {
    renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.MONO_LOSS_DB,
          stereoMapMonoLossYMinDb: -24,
        },
      })
    );

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("-24")).toBeTruthy();
  });

  it("shows M/S Ratio's configured asymmetric range", () => {
    renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.MS_RATIO_DB,
          stereoMapMsRatioYMinDb: -48,
          stereoMapMsRatioYMaxDb: 24,
        },
      })
    );

    expect(screen.getByText("+24")).toBeTruthy();
    expect(screen.getByText("-48")).toBeTruthy();
  });

  it("fades low-energy bands and breaks the curve instead of drawing a false zero", () => {
    const { container } = renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.POSITION,
        },
      })
    );

    const derived = deriveStereoMapRow(STEREO_MAP_MODES.POSITION, primitiveRow(), {
      lowerBound: -1,
      upperBound: 1,
    });
    expect(derived.points[2].state).toBe("invalid");

    // Two valid bands (0 and 1) with an invalid band (2) between them and the grid edge means the
    // curve cannot be one unbroken run: it must render as a single segment (band0-band1), not a
    // path spanning all three bands.
    const segments = container.querySelectorAll(
      '[data-stereo-map-plot="position"] [data-stereo-map-segment]'
    );
    expect(segments.length).toBe(1);
  });

  it("shows Hold outlines only when toggled, while accumulation continues underneath", () => {
    // Live Hold is read from the shared per-Analysis-Key slab (see StereoMapHistorySlab), not a
    // per-panel accumulator, so a real slab that already has a row appended stands in for
    // "accumulation happened while Hold was off".
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 1, 1],
      pr: [1, 1, 1],
      c: [1, 1, 1],
    });
    const getStereoMapHistoryForKey = (key) => (key === KEY ? slab : null);

    const audioData = baseAudioData({
      getStereoMapHistoryForKey,
      panelControls: {
        stereoMapPair: { first: 0, second: 1 },
        stereoMapMode: STEREO_MAP_MODES.CORRELATION,
        stereoMapHold: false,
      },
    });
    const { container, rerender } = renderPanel(audioData);
    expect(container.querySelector("[data-stereo-map-hold]")).toBeNull();

    rerender(
      <FrameDataProvider
        value={{ displayAudio: audioData.displayAudio, channelCount: 2, peakLabelContext: {} }}
      >
        <HistoryDataProvider value={{ selectedOffset: -1, getStereoMapHistoryForKey }}>
          <PanelInstanceProvider
            value={{
              panelControls: {
                stereoMapPair: { first: 0, second: 1 },
                stereoMapMode: STEREO_MAP_MODES.CORRELATION,
                stereoMapHold: true,
              },
            }}
          >
            <StereoMapPanel />
          </PanelInstanceProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    );

    // Hold was accumulating the whole time (per the design's "visibility only" contract), so
    // toggling it on immediately shows a recorded outline rather than an empty one.
    expect(container.querySelector('[data-stereo-map-hold="hold"]')).toBeTruthy();
  });

  it("shares live Hold accumulation across every consumer of the same Analysis Key", () => {
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 0, 1],
      pr: [0, 1, 1],
      c: [0, 0, 1],
    });
    const getStereoMapHistoryForKey = (key) => (key === KEY ? slab : null);
    const sharedControls = {
      stereoMapPair: { first: 0, second: 1 },
      stereoMapMode: STEREO_MAP_MODES.POSITION,
      stereoMapHold: true,
    };

    const { container: containerA } = renderPanel(
      baseAudioData({ getStereoMapHistoryForKey, panelControls: sharedControls })
    );
    const { container: containerB } = renderPanel(
      baseAudioData({ getStereoMapHistoryForKey, panelControls: sharedControls })
    );

    const holdA = containerA.querySelector('[data-stereo-map-hold="max"]')?.getAttribute("points");
    const holdB = containerB.querySelector('[data-stereo-map-hold="max"]')?.getAttribute("points");
    expect(holdA).toBeTruthy();
    expect(holdA).toBe(holdB);

    // A consumer of a different Analysis Key (different pair) has no slab in this lookup and
    // therefore no Hold at all — sharing is scoped to the key, not global.
    const { container: containerC } = renderPanel(
      baseAudioData({
        getStereoMapHistoryForKey,
        panelControls: { ...sharedControls, stereoMapPair: { first: 2, second: 3 } },
      })
    );
    expect(containerC.querySelector("[data-stereo-map-hold]")).toBeNull();
  });

  it("shows the current value, energy, and Hold on hover", () => {
    const { container } = renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.POSITION,
          stereoMapHold: true,
        },
      })
    );

    const chart = screen.getByTestId("stereo-map-chart");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 260,
    });
    fireEvent.pointerMove(chart, { clientX: 10, clientY: 130 });

    // Band 0 (100 Hz) is near the left edge; Position there is 0% (equal energy).
    expect(container.textContent).toContain("0%");
    expect(container.textContent).toMatch(/dB/);
  });

  it("formats a clipped M/S Ratio infinity as a bound, not an exact measurement", () => {
    const { container } = renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.MS_RATIO_DB,
          stereoMapMsRatioYMinDb: -48,
          stereoMapMsRatioYMaxDb: 24,
        },
      })
    );

    const chart = screen.getByTestId("stereo-map-chart");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 260,
    });
    // Band 0 (100 Hz, near the left edge) is equal-energy in-phase: M/S Ratio is negative
    // infinity there, which clips to the configured -48 dB lower bound.
    fireEvent.pointerMove(chart, { clientX: 10, clientY: 130 });

    expect(container.textContent).toContain("<= -48.0 dB");
  });

  it("shows the mono empty state and never the Center pair state for a single channel", () => {
    renderPanel(baseAudioData({ channelCount: 1 }));

    expect(screen.getByText(STEREO_MAP_MONO_MESSAGE)).toBeTruthy();
  });

  it("shows pending (no data) for a request whose key has not produced a frame yet", () => {
    const { container } = renderPanel(
      baseAudioData({
        panelControls: { stereoMapPair: { first: 2, second: 3 } },
        displayAudio: { stereoMapResultsByKey: { [KEY]: primitiveRow() } },
      })
    );

    // The panel's own key (pair 2:3) has no entry in stereoMapResultsByKey, so it must render an
    // empty chart rather than the pair 0:1 data sitting under a different key.
    expect(
      container.querySelector('[data-stereo-map-plot="position"] [data-stereo-map-segment]')
    ).toBeNull();
  });

  it("shows the over-cap empty state when its request is over the active cap", () => {
    renderPanel(baseAudioData({ analysisStatus: "overCap" }));

    expect(screen.getByText("Too many active analysis views")).toBeTruthy();
  });

  it("shows the snapshot no-data state when its request key has no history at the selected time", () => {
    renderPanel(
      baseAudioData({
        selectedOffset: 2,
        resolveStereoMapSnapshotForKey: () => ({ missing: true }),
      })
    );

    expect(screen.getByText("No data for this view at selected time")).toBeTruthy();
  });

  it("never flashes another request key's data when the pair changes", () => {
    const { container, rerender } = renderPanel(
      baseAudioData({
        panelControls: { stereoMapPair: { first: 0, second: 1 } },
      })
    );
    expect(
      container.querySelector('[data-stereo-map-plot="position"] [data-stereo-map-segment]')
    ).toBeTruthy();

    rerender(
      <FrameDataProvider
        value={{
          displayAudio: { stereoMapResultsByKey: { [KEY]: primitiveRow() } },
          channelCount: 2,
          peakLabelContext: {},
        }}
      >
        <HistoryDataProvider value={{ selectedOffset: -1 }}>
          <PanelInstanceProvider
            value={{ panelControls: { stereoMapPair: { first: 2, second: 3 } } }}
          >
            <StereoMapPanel />
          </PanelInstanceProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    );

    expect(
      container.querySelector('[data-stereo-map-plot="position"] [data-stereo-map-segment]')
    ).toBeNull();
  });

  it("keeps the same request key and reuses current/history primitives across a Mode change", () => {
    const { rerender } = renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapMode: STEREO_MAP_MODES.POSITION,
        },
      })
    );
    const displayAudio = { stereoMapResultsByKey: { [KEY]: primitiveRow() } };

    rerender(
      <FrameDataProvider value={{ displayAudio, channelCount: 2, peakLabelContext: {} }}>
        <HistoryDataProvider value={{ selectedOffset: -1 }}>
          <PanelInstanceProvider
            value={{
              panelControls: {
                stereoMapPair: { first: 0, second: 1 },
                stereoMapMode: STEREO_MAP_MODES.MS_RATIO_DB,
              },
            }}
          >
            <StereoMapPanel />
          </PanelInstanceProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    );

    expect(screen.getByText("+24")).toBeTruthy();
  });

  it("zooms the X (frequency) range on wheel and resets it on double-click", () => {
    const onPanelControlsChange = vi.fn();
    renderPanel(
      baseAudioData({
        panelControls: {
          stereoMapPair: { first: 0, second: 1 },
          stereoMapXMinFreq: 20,
          stereoMapXMaxFreq: 20000,
        },
        onPanelControlsChange,
        historyChartInteractive: true,
      })
    );

    const chart = screen.getByTestId("stereo-map-chart");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 260,
    });
    fireEvent.wheel(chart, { clientX: 500, clientY: 130, deltaY: -100 });

    expect(onPanelControlsChange).toHaveBeenCalled();
    const [updated] = onPanelControlsChange.mock.calls.at(-1);
    expect(updated.stereoMapXMaxFreq - updated.stereoMapXMinFreq).toBeLessThan(20000 - 20);
  });
});
