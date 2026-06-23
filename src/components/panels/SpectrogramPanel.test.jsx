/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { SpectrogramPanel } from "./SpectrogramPanel.jsx";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";

vi.mock("../../hooks/useSpectrogramCanvas", () => ({
  useSpectrogramCanvas: vi.fn(),
}));

function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}

const baseAudioData = {
  getSpectrogramSnapsForKey: () => EMPTY_SPECTRUM_VIEW,
  snapshotSpectrumByKey: {},
  frequencyMarkerRef: { current: [] },
  effectiveOffsetSamples: 0,
  visibleSamples: 0,
  selectedOffset: -1,
  setSelectedOffset: vi.fn(),
  showSelLine: false,
  selLineX: 0,
  totalSamples: 0,
  histSourceList: [],
  historyChartInteractive: false,
  onHistoryPointerDown: vi.fn(),
  onHistoryPointerMove: vi.fn(),
  onHistoryPointerUp: vi.fn(),
  onHistoryWheel: vi.fn(),
  historyTimeTicks: ["0s", "15s", "30s", "45s", "60s"],
  resolvedThemeId: "plvs-dark",
};

function renderPanel(value = {}, props = {}) {
  return render(
    <AudioDataContext.Provider value={{ ...baseAudioData, ...value }}>
      <SpectrogramPanel {...props} />
    </AudioDataContext.Provider>
  );
}

beforeEach(() => {
  vi.mocked(useSpectrogramCanvas).mockClear();

  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

describe("SpectrogramPanel", () => {
  it("keeps the time axis in a dedicated layout row", () => {
    const { container } = renderPanel();
    const axisRow = screen.getByText("30s").parentElement?.parentElement;
    const grid = axisRow?.parentElement;
    const chartInset = container.querySelector("canvas")?.parentElement;

    expect(grid?.className).toContain("grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)]");
    expect(axisRow?.className).toContain("relative");
    expect(axisRow?.className).not.toContain("absolute");
    expect(axisRow?.className).not.toContain("bottom-0");
    expect(chartInset?.className).not.toContain("min-h-[var(--ui-min-h-history-chart)]");
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("passes the resolved theme colormap to the canvas hook", () => {
    renderPanel({ resolvedThemeId: "plvs-dark" });
    const darkLut = vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)?.[0].colormapLut;

    renderPanel({ resolvedThemeId: "plvs-light" });
    const lightLut = vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)?.[0].colormapLut;

    expect(darkLut).toBeInstanceOf(Uint8Array);
    expect(lightLut).toBeInstanceOf(Uint8Array);
    expect(Array.from(lightLut)).toEqual(Array.from(darkLut));
  });

  it("feeds the canvas only its own request key's frozen snapshot history", () => {
    const panelControls = { spectrumChannel: { type: "single", ch: 1 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    const mine = viewOf([{ dbList: [-10], timestampMs: 1 }]);
    renderPanel({
      selectedOffset: 2,
      panelControls,
      snapshotSpectrumByKey: {
        [key]: mine,
        "spectrum:single:9:combined": viewOf([{ dbList: [-99], timestampMs: 1 }]),
      },
    });

    const frozen = vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)?.[0].frozenSnaps;
    expect(frozen).toBe(mine);
  });

  it("shows the over-cap empty state instead of the canvas when over the active cap", () => {
    const { container } = renderPanel({ analysisStatus: "overCap" });

    expect(screen.getByText("Too many active analysis views")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("reads its own request key's live rolling history in live mode", () => {
    const panelControls = { spectrumChannel: { type: "single", ch: 2 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    const getSpectrogramSnapsForKey = vi.fn(() => EMPTY_SPECTRUM_VIEW);
    renderPanel({ selectedOffset: -1, panelControls, getSpectrogramSnapsForKey });

    expect(getSpectrogramSnapsForKey).toHaveBeenCalledWith(key);
  });

  it("updates the live time window when the stable history array mutates in place", () => {
    const histSourceList = [];
    const props = {
      histSourceList,
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
    };
    const { rerender } = renderPanel(props);

    expect(vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)?.[0].newestMs).toBeNaN();

    histSourceList.push({ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1200 });
    rerender(
      <AudioDataContext.Provider value={{ ...baseAudioData, ...props }}>
        <SpectrogramPanel />
      </AudioDataContext.Provider>
    );

    const canvasArgs = vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)?.[0];
    expect(canvasArgs.oldestMs).toBe(1000);
    expect(canvasArgs.newestMs).toBe(1200);
  });

  it("hides frequency change markers when no selectable channel chip is shown", () => {
    const { container } = renderPanel({
      channelCount: 2,
      spectrumChannelOptions: [{ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } }],
      frequencyMarkerRef: {
        current: [null, { type: "frequencyChannelChange", from: "L/R", to: "C" }],
      },
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1200 }],
      totalSamples: 3,
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
    });

    expect(container.querySelector('line[stroke-dasharray="2 4"]')).toBeNull();
  });

  it("shows frequency change markers when the channel chip is selectable", () => {
    const { container } = renderPanel({
      channelCount: 6,
      spectrumChannelOptions: [
        { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
        { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
      ],
      frequencyMarkerRef: {
        current: [null, { type: "frequencyChannelChange", from: "L/R", to: "C" }],
      },
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1100 }, { timestampMs: 1200 }],
      totalSamples: 3,
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
    });

    expect(container.querySelector('line[stroke-dasharray="2 4"]')).toBeTruthy();
  });

  it("draws a data-availability boundary line where this view's history starts mid-window", () => {
    const panelControls = { spectrumChannel: { type: "single", ch: 1 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    // Window [1000, 2000] from history; this key's frames only start at 1500 (leading gap).
    const frames = [];
    for (let ts = 1500; ts <= 2000; ts += 40) frames.push({ timestampMs: ts, dbList: [-10] });
    const { container } = renderPanel({
      selectedOffset: 2,
      panelControls,
      channelCount: 6,
      spectrumChannelOptions: [
        { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
        { key: "s-1", label: "C", sel: { type: "single", ch: 1 } },
      ],
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1500 }, { timestampMs: 2000 }],
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
      snapshotSpectrumByKey: { [key]: viewOf(frames) },
    });

    const boundary = container.querySelector('line[stroke-dasharray="1 5"]');
    expect(boundary).toBeTruthy();
    // x = (1500 - 1000) / (2000 - 1000) * 1000 = 500
    expect(Number(boundary.getAttribute("x1"))).toBeCloseTo(500);
  });

  it("hides data-availability boundary lines when no selectable channel chip is shown", () => {
    const panelControls = { spectrumChannel: { type: "pair", x: 0, y: 1 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    const frames = [];
    for (let ts = 1500; ts <= 2000; ts += 40) frames.push({ timestampMs: ts, dbList: [-10] });
    const { container } = renderPanel({
      selectedOffset: 2,
      panelControls,
      channelCount: 2,
      spectrumChannelOptions: [{ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } }],
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1500 }, { timestampMs: 2000 }],
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
      snapshotSpectrumByKey: { [key]: viewOf(frames) },
    });

    expect(container.querySelector('line[stroke-dasharray="1 5"]')).toBeNull();
  });

  it("draws no boundary line for a continuous capture filling the window", () => {
    const panelControls = { spectrumChannel: { type: "single", ch: 1 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    const frames = [];
    for (let ts = 900; ts <= 2100; ts += 40) frames.push({ timestampMs: ts, dbList: [-10] });
    const { container } = renderPanel({
      selectedOffset: 2,
      panelControls,
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1500 }, { timestampMs: 2000 }],
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
      snapshotSpectrumByKey: { [key]: viewOf(frames) },
    });

    expect(container.querySelector('line[stroke-dasharray="1 5"]')).toBeNull();
  });

  it("hides the gestures help button in compact mode", () => {
    renderPanel({}, { compact: true });

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });
});
