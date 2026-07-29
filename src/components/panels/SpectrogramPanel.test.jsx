/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  FrameDataProvider,
  HistoryDataProvider,
  PanelInstanceProvider,
} from "../../workspace/AudioDataContext.jsx";
import { SpectrogramPanel } from "./SpectrogramPanel.jsx";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";
import { useSpectrogram3dCanvas } from "../../hooks/useSpectrogram3dCanvas";
import { buildProjection, projectPoint } from "../../math/spectrogram3dProjection.js";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";
import { SparseHistoryMarkers } from "../../lib/SparseHistoryMarkers.js";

vi.mock("../../hooks/useSpectrogramCanvas", () => ({
  useSpectrogramCanvas: vi.fn(),
}));

vi.mock("../../hooks/useSpectrogram3dCanvas", () => ({
  useSpectrogram3dCanvas: vi.fn(),
}));

// jsdom has no native PointerEvent constructor, so fireEvent.pointerMove's clientX/clientY never
// reach the handler without this — every field lands as undefined and hover math silently NaNs
// out. MouseEvent already carries clientX/clientY, so subclassing it is enough for the fields this
// suite reads.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

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
  return render(spectrogramPanelTree(value, props));
}

function spectrogramPanelTree(value = {}, props = {}) {
  const {
    panelControls,
    analysisStatus,
    onPanelControlsChange,
    channelCount,
    spectrumChannelOptions,
    resolvedThemeId,
    ...history
  } = value;
  const base = { ...baseAudioData, ...history };
  const frameData = {
    channelCount: channelCount ?? base.channelCount,
    spectrumChannelOptions: spectrumChannelOptions ?? base.spectrumChannelOptions,
    resolvedThemeId: resolvedThemeId ?? base.resolvedThemeId,
  };
  return (
    <FrameDataProvider value={frameData}>
      <HistoryDataProvider value={base}>
        <PanelInstanceProvider value={{ panelControls, analysisStatus, onPanelControlsChange }}>
          <SpectrogramPanel {...props} />
        </PanelInstanceProvider>
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

beforeEach(() => {
  vi.mocked(useSpectrogramCanvas).mockClear();
  vi.mocked(useSpectrogram3dCanvas).mockClear();

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

  it("keeps frequency axis endpoint labels inside the chart bounds", () => {
    const { container } = renderPanel();

    expect(screen.getByText("20k").className).toContain("top-0");
    expect(screen.getByText("20k").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("20").className).toContain("bottom-0");
    expect(screen.getByText("20").className).not.toContain("-translate-y-1/2");
    expect(
      Array.from(container.querySelectorAll("span")).some((span) =>
        span.className.includes("-translate-y-1/2")
      )
    ).toBe(true);
  });

  it("updates the chart cursor when ctrl is pressed while hovering", () => {
    const { container } = renderPanel({ historyChartInteractive: true });
    const chart = container.querySelector("canvas");

    fireEvent.pointerMove(chart, { ctrlKey: false });
    expect(chart?.style.cursor).toBe("crosshair");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });

    expect(chart?.style.cursor).toBe("grab");
  });

  it("highlights the frequency axis when chart ctrl wheel changes the y range", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
    });
    const chart = container.querySelector("canvas");

    fireEvent.wheel(chart, {
      ctrlKey: true,
      deltaY: -100,
      clientY: 100,
    });

    const yAxis = screen.getByText("20k").parentElement?.parentElement;
    expect(onPanelControlsChange).toHaveBeenCalled();
    expect(yAxis?.className).toContain("text-foreground");
    expect(yAxis?.className).not.toContain("var(--muted)_44%");
  });

  it("highlights the time axis when time changes elsewhere", () => {
    renderPanel({ historyTimeAxisActive: true });

    const timeAxis = screen.getByText("30s").parentElement?.parentElement;
    expect(timeAxis?.className).toContain("text-foreground");
    expect(timeAxis?.className).not.toContain("var(--muted)_44%");
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
    rerender(spectrogramPanelTree(props));

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

  it("queries sparse frequency markers and preserves their exact x positions", () => {
    const frequencyMarkerIndex = new SparseHistoryMarkers(5);
    frequencyMarkerIndex.push(null);
    frequencyMarkerIndex.push({ type: "frequencyChannelChange", from: "L/R", to: "C" });
    frequencyMarkerIndex.push(null);
    frequencyMarkerIndex.push({ type: "frequencyChannelChange", from: "C", to: "LFE" });
    frequencyMarkerIndex.push(null);

    const { container } = renderPanel({
      channelCount: 6,
      spectrumChannelOptions: [
        { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
        { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
      ],
      frequencyMarkerIndex,
      frequencyMarkerRef: {
        current: [
          { type: "frequencyChannelChange", from: "wrong", to: "fallback" },
          null,
          null,
          null,
          null,
        ],
      },
      histSourceList: Array.from({ length: 5 }, (_, index) => ({ timestampMs: index * 100 })),
      totalSamples: 5,
      effectiveOffsetSamples: 0,
      visibleSamples: 4,
    });

    const lines = Array.from(container.querySelectorAll('line[stroke-dasharray="2 4"]'));
    expect(lines.map((line) => Number(line.getAttribute("x1")))).toEqual([0, 2000 / 3]);
    expect(lines.map((line) => line.querySelector("title")?.textContent)).toEqual([
      "Frequency channel changed: L/R -> C",
      "Frequency channel changed: C -> LFE",
    ]);
  });

  it("queries 240 minutes of sparse markers without scanning retained rows", () => {
    const rowCount = 360_000;
    const frequencyMarkerIndex = new SparseHistoryMarkers(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      frequencyMarkerIndex.push(
        index === rowCount - 1 ? { type: "frequencyChannelChange", from: "L/R", to: "C" } : null
      );
    }

    const { container } = renderPanel({
      channelCount: 6,
      spectrumChannelOptions: [
        { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
        { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
      ],
      frequencyMarkerIndex,
      histSourceList: [{ timestampMs: 0 }, { timestampMs: rowCount * 100 }],
      totalSamples: rowCount,
      effectiveOffsetSamples: 0,
      visibleSamples: 100,
    });

    expect(container.querySelector('line[stroke-dasharray="2 4"]')).toBeTruthy();
    expect(frequencyMarkerIndex.lastQueryStats()).toMatchObject({
      markersReturned: 1,
      markersInspected: 1,
    });
    expect(frequencyMarkerIndex.lastQueryStats().binarySearchReads).toBeLessThanOrEqual(2);
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

  it("suppresses the hover readout in 3D but shows it in 2D", () => {
    // useChartHover coalesces pointer moves into a requestAnimationFrame callback; stub rAF with a
    // manually-flushed queue (same pattern as useChartHover.test.js) so the hover state update can
    // be observed synchronously inside act().
    const rafCallbacks = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const flushRaf = () => rafCallbacks.splice(0, rafCallbacks.length).forEach((cb) => cb());

    try {
      const panelControls = { spectrumChannel: { type: "single", ch: 1 } };
      const key = spectrumRequestKeyFromControls(panelControls);
      const frame = viewOf([{ dbList: [-10], timestampMs: 1000, bands: [{ fCenter: 1000 }] }]);
      const commonProps = {
        selectedOffset: 2,
        historyChartInteractive: true,
        histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1500 }, { timestampMs: 2000 }],
        effectiveOffsetSamples: 0,
        visibleSamples: 3,
        snapshotSpectrumByKey: { [key]: frame },
      };

      const twoD = renderPanel({ ...commonProps, panelControls });
      act(() => {
        fireEvent.pointerMove(twoD.container.querySelector("canvas"), { clientX: 0, clientY: 0 });
        flushRaf();
      });
      expect(screen.getByText("-10.0 dB")).toBeTruthy();
      twoD.unmount();

      const threeD = renderPanel({
        ...commonProps,
        panelControls: { ...panelControls, spectrogram3d: true },
      });
      act(() => {
        fireEvent.pointerMove(threeD.container.querySelector("canvas"), { clientX: 0, clientY: 0 });
        flushRaf();
      });
      expect(screen.queryByText("-10.0 dB")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides the SVG overlay lines in 3D even though 2D draws them", () => {
    const panelControls = { spectrumChannel: { type: "single", ch: 1 } };
    const key = spectrumRequestKeyFromControls(panelControls);
    const frames = [];
    for (let ts = 1500; ts <= 2000; ts += 40) frames.push({ timestampMs: ts, dbList: [-10] });
    const commonProps = {
      selectedOffset: 2,
      showSelLine: true,
      channelCount: 6,
      spectrumChannelOptions: [
        { key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } },
        { key: "s-1", label: "C", sel: { type: "single", ch: 1 } },
      ],
      histSourceList: [{ timestampMs: 1000 }, { timestampMs: 1500 }, { timestampMs: 2000 }],
      effectiveOffsetSamples: 0,
      visibleSamples: 3,
      snapshotSpectrumByKey: { [key]: viewOf(frames) },
    };

    const twoD = renderPanel({ ...commonProps, panelControls });
    // Data-availability boundary line: this key's frames only start at 1500 within window [1000,2000].
    expect(twoD.container.querySelector('line[stroke-dasharray="1 5"]')).toBeTruthy();
    twoD.unmount();

    const threeD = renderPanel({
      ...commonProps,
      panelControls: { ...panelControls, spectrogram3d: true },
    });
    expect(threeD.container.querySelector("svg")).toBeNull();
  });

  it("unprojects the pointer through the floor plane before delegating 3D time selection", () => {
    // Pins the inverted-scrubbing fix: onSpectrogramChartPointerDown must convert a click through
    // unprojectFloor before handing it to the shared useHistoryInteraction handlers, not forward
    // the raw (rotated) screen position. useSpectrogram3dCanvas is mocked in this suite, so the
    // live projection never gets published for real -- publish one by hand via the projectionRef
    // the component passed to the mocked hook, then click at the exact device pixel that
    // projectPoint says corresponds to 20% across the time window.
    const onHistoryPointerDown = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onHistoryPointerDown,
      panelControls: { spectrogram3d: true },
    });
    const canvas = container.querySelector("canvas");
    // jsdom's canvas defaults to 300x150 device pixels; give it a matching 1:1 CSS rect so the
    // device-pixel conversion inside the panel's cursorToFloor helper is a no-op here.
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 150,
      width: 300,
      height: 150,
    });

    const projectionRef = vi.mocked(useSpectrogram3dCanvas).mock.calls.at(-1)?.[0].projectionRef;
    const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 60, width: 300, height: 150 });
    projectionRef.current = proj;

    const targetTFrac = 0.2;
    const pt = projectPoint(targetTFrac, 0.5, 0, proj);

    fireEvent.pointerDown(canvas, { button: 0, clientX: pt.x, clientY: pt.y });

    expect(onHistoryPointerDown).toHaveBeenCalledTimes(1);
    const forwarded = onHistoryPointerDown.mock.calls[0][0];
    // Correctly unprojected: the shared handler receives the linear-layout clientX it expects
    // (tFrac * width) -- not the raw rotated screen pixel the click actually landed on, which sits
    // far to the right of that at this azimuth (proving the naive pass-through would invert it).
    expect(forwarded.clientX).toBeCloseTo(targetTFrac * 300, 5);
    expect(forwarded.clientX).not.toBeCloseTo(pt.x, 0);
  });

  it("keeps the Y rail on frequency in 3D, ticks and all", () => {
    const { rerender } = renderPanel();

    expect(screen.getByText("20k")).toBeTruthy();

    rerender(spectrogramPanelTree({ panelControls: { spectrogram3d: true } }));

    // The rail does not change meaning between modes: same ticks, no "dB" placeholder.
    expect(screen.getByText("20k")).toBeTruthy();
    expect(screen.queryByText("dB")).toBeNull();
  });

  it("zooms the Y rail to the frequency range in 3D, not to height scale", () => {
    // The regression this pins is the rebinding itself: the rail used to write
    // spectrogram3dHeightGain here, which silently made the frequency axis unreachable in 3D.
    const onPanelControlsChange = vi.fn();
    renderPanel({
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    // Do not assert on the rail's cursor. useAxisInteraction returns "ns-resize" for every y axis,
    // so the old code's `is3d ? "ns-resize" : cursorStyle` had two branches with the same value --
    // a cursor check cannot tell the rebinding from its absence.
    const rail = screen.getByText("20k").closest("div[class*='shrink-0']");
    // jsdom reports a zero rect, which collapses useAxisInteraction's anchor math to the bottom of
    // the range: the zoom still happens, so the assertions below survive without this stub, but the
    // gesture under test would not be the one that ships. A real rect makes it the mid-rail zoom a
    // user performs.
    rail.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 32,
      bottom: 300,
      width: 32,
      height: 300,
    });
    fireEvent.wheel(rail, { deltaY: -100, clientY: 150 });

    expect(onPanelControlsChange).toHaveBeenCalled();
    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBe(1);
    expect(next.spectrogramYMinFreq).toBeGreaterThan(20);
    expect(next.spectrogramYMaxFreq).toBeLessThan(20000);
  });

  it("ignores pointer events on the Y rail in 3D", () => {
    // The removed rebinding lived on pointer events and useAxisInteraction listens for mouse
    // events, so the rail should have no pointer handlers at all now. setPointerCapture has to be
    // stubbed or this proves nothing: jsdom does not implement it, the old handler called it on
    // its first line, and the resulting throw would leave the drag state unset and this assertion
    // passing against the very code it excludes.
    const onPanelControlsChange = vi.fn();
    renderPanel({
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    const rail = screen.getByText("20k").closest("div[class*='shrink-0']");
    rail.setPointerCapture = () => {};
    rail.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 32,
      bottom: 300,
      width: 32,
      height: 300,
    });

    fireEvent.pointerDown(rail, { button: 0, clientY: 150 });
    fireEvent.pointerMove(rail, { clientY: 40 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
  });

  it("drags the Y rail to pan the frequency range in 3D", () => {
    const onPanelControlsChange = vi.fn();
    renderPanel({
      onPanelControlsChange,
      panelControls: {
        spectrogram3d: true,
        // A full-span range cannot pan -- clampRange returns absMin/absMax unchanged for any
        // drag -- so starting at the 20-20000 default would assert against a guaranteed no-op.
        spectrogramYMinFreq: 100,
        spectrogramYMaxFreq: 10000,
      },
    });

    // The rail starts at 100-10000 here (see above), so its endpoint tick reads "10k", not "20k".
    const rail = screen.getByText("10k").closest("div[class*='shrink-0']");
    rail.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 32,
      bottom: 300,
      width: 32,
      height: 300,
    });

    fireEvent.mouseDown(rail, { button: 0, clientY: 150 });
    fireEvent.mouseMove(window, { clientY: 100 });

    expect(onPanelControlsChange).toHaveBeenCalled();
    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBe(1);
    // Both ends move the same way: that is a pan. A zoom would move them apart, a no-op neither.
    expect(next.spectrogramYMinFreq).toBeLessThan(100);
    expect(next.spectrogramYMaxFreq).toBeLessThan(10000);
  });

  it("scales height on Shift+wheel in 3D, from deltaY", () => {
    const onPanelControlsChange = vi.fn();
    const onHistoryWheel = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      onHistoryWheel,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: -100 });

    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBeCloseTo(0.85, 5);
    expect(next.spectrogramYMinFreq).toBe(20);
    expect(next.spectrogramYMaxFreq).toBe(20000);
    // Pins the branch's own `return`: without it a shifted wheel would scale height and then fall
    // through to the timeline zoom, firing both gestures on one notch.
    expect(onHistoryWheel).not.toHaveBeenCalled();
  });

  it("scales height on Shift+wheel in 3D, from deltaX", () => {
    // Chrome on Windows swaps deltaY into deltaX while Shift is held -- the horizontal-scroll
    // convention. A handler that only reads deltaY is silently dead for the real gesture, and
    // every jsdom test that synthesises deltaY still passes. This is that test.
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaX: 100, deltaY: 0 });

    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrogram3dHeightGain).toBeCloseTo(1.18, 5);
  });

  it("clamps Shift+wheel height scaling at the top of its range", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true, spectrogram3dHeightGain: 3 },
    });

    // Zoom in from the same fixture first, so the ceiling assertion below cannot be satisfied by a
    // handler that simply echoed its input.
    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: -100 });
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrogram3dHeightGain).toBeCloseTo(2.55, 5);

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: 100 });

    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrogram3dHeightGain).toBe(3);
  });

  it("keeps Ctrl+Shift+wheel on frequency in 3D", () => {
    // Ctrl outranks Shift: Ctrl+wheel means frequency in both modes, and adding Shift must not
    // reassign it to height. Without the `!e.ctrlKey` in the guard this goes to the height branch.
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), {
      ctrlKey: true,
      shiftKey: true,
      deltaY: -100,
      clientY: 100,
    });

    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBe(1);
    expect(next.spectrogramYMaxFreq).toBeLessThan(20000);
  });

  it("swallows a notch-less Shift+wheel in 3D rather than forwarding it", () => {
    // A zero delta must not reach onHistoryWheel: its own sign test treats deltaY 0 as "not less
    // than zero" and would zoom time out on an event that carried no motion.
    const onPanelControlsChange = vi.fn();
    const onHistoryWheel = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      onHistoryWheel,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaX: 0, deltaY: 0 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
    expect(onHistoryWheel).not.toHaveBeenCalled();
  });

  it("ignores Shift+wheel in 2D", () => {
    const onPanelControlsChange = vi.fn();
    const onHistoryWheel = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      onHistoryWheel,
      panelControls: {},
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: -100 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
    // Falls through to the ordinary time-zoom path, exactly as an unmodified wheel would.
    expect(onHistoryWheel).toHaveBeenCalledTimes(1);
  });

  // The right-drag path calls setPointerCapture, which jsdom does not implement on these elements.
  function stubPointerCapture(canvas) {
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
  }

  it("resets the viewpoint on a right double-click in 3D", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {
        spectrogram3d: true,
        spectrogram3dAzimuthDeg: 20,
        spectrogram3dElevationDeg: 10,
      },
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 150,
      width: 300,
      height: 150,
    });

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 101, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 101, clientY: 100 });

    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dAzimuthDeg).toBe(135);
    expect(next.spectrogram3dElevationDeg).toBe(60);
  });

  it("does not reset when the second right press was a rotation drag", () => {
    // Without a movement threshold, rotating out and happening to release near the start reads as
    // a double-click and throws away the viewpoint the user was aiming at.
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {
        spectrogram3d: true,
        spectrogram3dAzimuthDeg: 20,
        spectrogram3dElevationDeg: 10,
      },
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 150,
      width: 300,
      height: 150,
    });

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 130 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 160, clientY: 130 });

    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dAzimuthDeg).not.toBe(135);
  });

  it("ignores a right double-click in 2D", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {},
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 150,
      width: 300,
      height: 150,
    });

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
  });

  it("does not reset when the two right clicks are far apart in time", () => {
    // Pins RIGHT_DOUBLE_CLICK_MS. Both clicks are stationary, so without the time bound the second
    // release satisfies every other condition and resets a viewpoint the user set minutes ago.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      const onPanelControlsChange = vi.fn();
      const { container } = renderPanel({
        historyChartInteractive: true,
        onPanelControlsChange,
        panelControls: {
          spectrogram3d: true,
          spectrogram3dAzimuthDeg: 20,
          spectrogram3dElevationDeg: 10,
        },
      });
      const canvas = container.querySelector("canvas");
      stubPointerCapture(canvas);
      canvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 300,
        bottom: 150,
        width: 300,
        height: 150,
      });

      fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });

      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 5));

      fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });

      expect(onPanelControlsChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
