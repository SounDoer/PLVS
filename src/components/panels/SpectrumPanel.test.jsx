/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  FrameDataProvider,
  HistoryDataProvider,
  PanelInstanceProvider,
} from "../../workspace/AudioDataContext.jsx";
import { SpectrumPanel } from "./SpectrumPanel.jsx";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { buildSpectrumSvgFromBandsAndDb } from "../../math/spectrumMath.js";
import { DEFAULT_PANEL_CONTROLS } from "../../lib/panelControls.js";
import {
  resetPanelCpuProfiler,
  setPanelCpuProfilerEnabled,
  snapshotPanelCpuProfiler,
} from "../../dev/panelCpuProfiler.js";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    g: React.forwardRef(function MotionG(
      { initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props },
      ref
    ) {
      return <g ref={ref} {...props} />;
    }),
  },
}));

function renderPanel(audioData) {
  return render(spectrumPanelTree(audioData));
}

function spectrumPanelTree(audioData) {
  const { panelControls, analysisStatus, onPanelControlsChange, displayAudio, ...historyData } =
    audioData;
  // The engine sends untilted rows and the panel puts the slope on at render, so the default
  // tilt would move every coordinate in here. Tests that are about the tilt set it themselves.
  const flatControls = { spectrumTiltDbPerOctave: 0, ...panelControls };
  return (
    <FrameDataProvider value={{ displayAudio }}>
      <HistoryDataProvider value={historyData}>
        <PanelInstanceProvider
          value={{ panelControls: flatControls, analysisStatus, onPanelControlsChange }}
        >
          <SpectrumPanel />
        </PanelInstanceProvider>
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

// Default panel controls resolve to this live request key (pair 0/1, combined view).
const LIVE_KEY = "spectrum:pair:0:1:combined:sp25:smoff";

// The frame carries dB rows only; every path on screen is built from them by the panel.
const BANDS = [20, 20000];

/** The curve the panel draws for `db`, in the same viewBox coordinates it uses. */
function contour(db, range) {
  return buildSpectrumSvgFromBandsAndDb(BANDS, db, range);
}

/** A contour closed into the filled area the panel draws under it. */
function area(path) {
  return `${path} L 1000 260 L 0 260 Z`;
}

function liveResult(over = {}) {
  return {
    bandCentersHz: [],
    smoothDb: [],
    peakDb: [],
    smoothDbB: [],
    peakDbB: [],
    ...over,
  };
}

/** Live audioData with a per-key spectrum result under the default panel's request key. */
function liveAudioData(result, rest = {}) {
  return {
    selectedOffset: -1,
    displayAudio: { spectrumResultsByKey: { [LIVE_KEY]: result } },
    ...rest,
  };
}

function primaryPath(container) {
  return container.querySelector('path[stroke="var(--ui-spectrum-primary)"]')?.getAttribute("d");
}

function firstPathY(path) {
  return Number(path?.match(/^M\s+[-\d.]+\s+([-\d.]+)/)?.[1]);
}

afterEach(() => {
  setPanelCpuProfilerEnabled(false);
  resetPanelCpuProfiler();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpectrumPanel", () => {
  it("reuses display data and paths across unrelated meter-frame renders", () => {
    setPanelCpuProfilerEnabled(true);
    const first = liveResult({
      bandCentersHz: [100, 1000, 10000],
      smoothDb: [-30, -20, -40],
      peakDb: [-25, -15, -35],
    });
    const { rerender } = renderPanel(liveAudioData(first));

    expect(snapshotPanelCpuProfiler()["spectrum:buildDisplayData"]?.count).toBe(1);
    expect(snapshotPanelCpuProfiler()["spectrum:buildPaths"]?.count).toBe(1);

    rerender(spectrumPanelTree(liveAudioData(first)));
    expect(snapshotPanelCpuProfiler()["spectrum:buildDisplayData"]?.count).toBe(1);
    expect(snapshotPanelCpuProfiler()["spectrum:buildPaths"]?.count).toBe(1);

    const second = liveResult({
      bandCentersHz: [100, 1000, 10000],
      smoothDb: [-29, -19, -39],
      peakDb: [-24, -14, -34],
    });
    rerender(spectrumPanelTree(liveAudioData(second)));
    expect(snapshotPanelCpuProfiler()["spectrum:buildDisplayData"]?.count).toBe(2);
    expect(snapshotPanelCpuProfiler()["spectrum:buildPaths"]?.count).toBe(2);
  });

  it("fills up to the peak contour when max hold is on", () => {
    const peakDb = [-20, -30];
    const { container } = renderPanel(
      liveAudioData(liveResult({ bandCentersHz: BANDS, smoothDb: [-40, -50], peakDb }), {
        panelControls: { spectrumMaxDecay: true },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(area(contour(peakDb)));
    // peak hold is now a filled area, not a dashed stroke
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull();
  });

  it("uses the active panel's peak-hold setting, not the first panel's", () => {
    const smoothDb = [-40, -50];
    // Global (first panel) has peak hold on, but this panel's own control has it off.
    const { container } = renderPanel(
      liveAudioData(liveResult({ bandCentersHz: BANDS, smoothDb, peakDb: [-20, -30] }), {
        spectrumMaxDecay: true,
        panelControls: { spectrumMaxDecay: false },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(area(contour(smoothDb)));
  });

  it("fills up to the live contour when peak hold is off", () => {
    const smoothDb = [-40, -50];
    const { container } = renderPanel(
      liveAudioData(liveResult({ bandCentersHz: BANDS, smoothDb, peakDb: [-20, -30] }), {
        panelControls: { spectrumMaxDecay: false },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(area(contour(smoothDb)));
  });

  it("fills the secondary peak with the live-b gradient when peak hold is on", () => {
    const peakDbB = [-25, -35];
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          bandCentersHz: BANDS,
          smoothDb: [-40, -50],
          smoothDbB: [-45, -55],
          peakDb: [-20, -30],
          peakDbB,
        }),
        { panelControls: { spectrumMaxDecay: true }, spectrumViewLegend: null }
      )
    );

    const fillB = container.querySelector('path[fill="url(#spectrumFillLiveB)"]');
    expect(fillB?.getAttribute("d")).toBe(area(contour(peakDbB)));
  });

  it("renders the secondary curve path with the live-b token when the result has a B path", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({ bandCentersHz: BANDS, smoothDb: [-40, -50], smoothDbB: [-45, -55] }),
        { spectrumViewLegend: null }
      )
    );

    const secondary = container.querySelector('path[stroke="var(--ui-spectrum-secondary)"]');
    expect(secondary).toBeTruthy();
  });

  it("keeps curve stroke widths independent from SVG scaling", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({ bandCentersHz: BANDS, smoothDb: [-40, -50], smoothDbB: [-45, -55] }),
        { spectrumViewLegend: null }
      )
    );

    const primary = container.querySelector('path[stroke="var(--ui-spectrum-primary)"]');
    const secondary = container.querySelector('path[stroke="var(--ui-spectrum-secondary)"]');
    expect(primary?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(secondary?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("rebuilds the live curve with the default -12..-96 dB Y range", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          bandCentersHz: [20, 20000],
          smoothDb: [0, -96],
        })
      )
    );

    const primary = container.querySelector('path[stroke="var(--ui-spectrum-primary)"]');
    expect(primary?.getAttribute("d")).toBe("M 0.00 10.00 L 1000.00 256.00");
  });

  it("uses the panel Y-axis controls when rebuilding the live curve", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          bandCentersHz: [20, 20000],
          smoothDb: [-24, -84],
        }),
        { panelControls: { spectrumYMaxDb: -24, spectrumYRangeDb: 60 } }
      )
    );

    const primary = container.querySelector('path[stroke="var(--ui-spectrum-primary)"]');
    expect(primary?.getAttribute("d")).toBe("M 0.00 10.00 L 1000.00 256.00");
  });

  it("rebuilds peak-hold fill with the selected Y range when peak dB data is present", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          bandCentersHz: [20, 20000],
          smoothDb: [-40, -70],
          peakDb: [-24, -84],
        }),
        { panelControls: { spectrumMaxDecay: true, spectrumYMaxDb: -24, spectrumYRangeDb: 60 } }
      )
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe("M 0.00 10.00 L 1000.00 256.00 L 1000 260 L 0 260 Z");
  });

  it("does not render the curve legend inside the chart area", () => {
    renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPathB: "M 0 130 L 1000 90",
      displaySpectrumPeakPath: "",
      selectedOffset: -1,
      displaySpectrumData: { bands: [], dbList: [], dbListB: [] },
      spectrumViewLegend: [
        { token: "primary", label: "M" },
        { token: "secondary", label: "S" },
      ],
    });

    expect(screen.queryByText("M")).toBeNull();
    expect(screen.queryByText("S")).toBeNull();
  });

  it("shows the no-data empty state when its request has no history at the selected time", () => {
    renderPanel({
      selectedOffset: 2,
      resolveSpectrumSnapshotForKey: () => ({ missing: true, path: "", pathB: "", data: null }),
    });

    expect(screen.getByText("No data for this view at selected time")).toBeTruthy();
  });

  it("shows the over-cap empty state when its request is over the active cap", () => {
    renderPanel({
      selectedOffset: -1,
      analysisStatus: "overCap",
    });

    expect(screen.getByText("Too many active analysis views")).toBeTruthy();
    // Over-cap is distinct from the snapshot no-data state.
    expect(screen.queryByText("No data for this view at selected time")).toBeNull();
  });

  it("renders its own request key's snapshot curve in snapshot mode", () => {
    // Snapshot rows come back untilted like live ones, and the panel builds the path from them.
    const dbList = [-30, -60];
    const { container } = renderPanel({
      selectedOffset: 2,
      resolveSpectrumSnapshotForKey: () => ({
        missing: false,
        data: {
          bands: BANDS.map((fCenter) => ({ fCenter })),
          dbList,
          dbListB: [],
        },
      }),
    });

    const snapStroke = container.querySelector('path[stroke="var(--ui-spectrum-primary-snap)"]');
    expect(snapStroke?.getAttribute("d")).toBe(contour(dbList));
  });

  it("tilts the live curve around 1 kHz without changing the request key", () => {
    // The engine sends untilted rows, so this slope is the panel's own work. 1 kHz is the pivot:
    // it does not move, and 20 Hz drops away below it.
    const smoothDb = [-40, -40, -40];
    const bandCentersHz = [20, 1000, 20000];
    const withTilt = (tilt) =>
      renderPanel(
        liveAudioData(liveResult({ bandCentersHz, smoothDb }), {
          panelControls: { spectrumTiltDbPerOctave: tilt },
        })
      );

    const flat = withTilt(0);
    const tilted = withTilt(3);
    const ys = (view) => (primaryPath(view.container).match(/[\d.]+(?= L|$)/g) ?? []).map(Number);

    const [flatLow, flatMid, flatHigh] = ys(flat);
    const [tiltedLow, tiltedMid, tiltedHigh] = ys(tilted);
    expect(tiltedMid).toBeCloseTo(flatMid, 5);
    expect(tiltedLow).toBeGreaterThan(flatLow);
    expect(tiltedHigh).toBeLessThan(flatHigh);
  });

  it("keeps one request key across tilt values", () => {
    // Two panels differing only in tilt share an engine consumer and a history slab.
    expect(spectrumRequestKeyFromControls({ spectrumTiltDbPerOctave: 0 })).toBe(
      spectrumRequestKeyFromControls({ spectrumTiltDbPerOctave: 6 })
    );
  });

  it("refreshes the live hover value when spectrum data changes without pointer movement", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => {
        cb();
        return 1;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 240,
      top: 0,
      right: 400,
      bottom: 240,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const { rerender } = render(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [-96, -96] }), {
          historyChartInteractive: true,
        })
      )
    );

    fireEvent.pointerMove(screen.getByTestId("spectrum-chart"), {
      clientX: 0,
      clientY: 120,
    });
    expect(screen.getByText("-96.0 dB")).toBeTruthy();

    rerender(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [0, 0] }), {
          historyChartInteractive: true,
        })
      )
    );

    expect(screen.getByText("0.0 dB")).toBeTruthy();
  });

  it("captures the current snapshot when left-clicking the chart with history data", () => {
    const captureCurrentSnapshot = vi.fn();
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
        totalSamples: 3,
        captureCurrentSnapshot,
      })
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent.click(chart);

    expect(captureCurrentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("temporarily enables display hold smoothing after a left-button hold", () => {
    vi.useFakeTimers();
    const captureCurrentSnapshot = vi.fn();
    const setSpectrumHoldSmoothing = vi.fn();
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
        totalSamples: 3,
        captureCurrentSnapshot,
        setSpectrumHoldSmoothing,
      })
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent(
      chart,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 80,
        ctrlKey: false,
      })
    );
    act(() => vi.advanceTimersByTime(299));
    expect(setSpectrumHoldSmoothing).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(setSpectrumHoldSmoothing).not.toHaveBeenCalled();

    fireEvent(
      chart,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 120,
        clientY: 80,
        ctrlKey: false,
      })
    );
    fireEvent(chart, new MouseEvent("pointerup", { bubbles: true }));
    expect(setSpectrumHoldSmoothing).not.toHaveBeenCalled();

    fireEvent.click(chart);
    expect(captureCurrentSnapshot).not.toHaveBeenCalled();
  });

  it("keeps using the panel request key while display hold smoothing is active", () => {
    vi.useFakeTimers();
    const smoothDb = [-40, -50];
    const { container } = renderPanel(
      liveAudioData(liveResult({ bandCentersHz: BANDS, smoothDb }), {
        historyChartInteractive: true,
        totalSamples: 3,
      })
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent(
      chart,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 80,
        ctrlKey: false,
      })
    );

    act(() => vi.advanceTimersByTime(300));

    expect(primaryPath(container)).toBe(contour(smoothDb));
  });

  it("smooths live curve changes locally while display hold smoothing is active", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [-96, -96] }), {
          historyChartInteractive: true,
          totalSamples: 3,
        })
      )
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent(
      chart,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 80,
        ctrlKey: false,
      })
    );
    act(() => vi.advanceTimersByTime(300));
    rerender(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [0, 0] }), {
          historyChartInteractive: true,
          totalSamples: 3,
        })
      )
    );

    const y = firstPathY(primaryPath(container));
    expect(y).toBeGreaterThan(10);
    expect(y).toBeLessThan(256);
  });

  it("returns to the immediate live curve after display hold smoothing is released", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [-96, -96] }), {
          historyChartInteractive: true,
          totalSamples: 3,
        })
      )
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent(
      chart,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 80,
        ctrlKey: false,
      })
    );
    act(() => vi.advanceTimersByTime(300));
    fireEvent(chart, new MouseEvent("pointerup", { bubbles: true }));
    rerender(
      spectrumPanelTree(
        liveAudioData(liveResult({ bandCentersHz: [20, 20000], smoothDb: [0, 0] }), {
          historyChartInteractive: true,
          totalSamples: 3,
        })
      )
    );

    expect(primaryPath(container)).toBe("M 0.00 10.00 L 1000.00 10.00");
  });

  it("cancels pending hold smoothing when the pointer moves before the hold delay", () => {
    vi.useFakeTimers();
    const captureCurrentSnapshot = vi.fn();
    const setSpectrumHoldSmoothing = vi.fn();
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
        totalSamples: 3,
        captureCurrentSnapshot,
        setSpectrumHoldSmoothing,
      })
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent(
      chart,
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 80,
        ctrlKey: false,
      })
    );
    fireEvent(
      chart,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 140,
        clientY: 80,
        ctrlKey: false,
      })
    );
    act(() => vi.advanceTimersByTime(300));
    fireEvent(chart, new MouseEvent("pointerup", { bubbles: true }));
    fireEvent.click(chart);

    expect(setSpectrumHoldSmoothing).not.toHaveBeenCalled();
    expect(captureCurrentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("zooms the frequency range when wheeling over the chart", () => {
    const onPanelControlsChange = vi.fn();
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 240,
      top: 0,
      right: 400,
      bottom: 240,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
        onPanelControlsChange,
      })
    );

    fireEvent.wheel(screen.getByTestId("spectrum-chart"), {
      deltaY: -100,
      clientX: 200,
      clientY: 120,
    });

    expect(onPanelControlsChange).toHaveBeenCalled();
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrumXMinFreq).toBeGreaterThan(20);
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrumXMaxFreq).toBeLessThan(20000);
    rectSpy.mockRestore();
  });

  it("zooms the dB range on ctrl wheel over the chart", () => {
    const onPanelControlsChange = vi.fn();
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 240,
      top: 0,
      right: 400,
      bottom: 240,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
        onPanelControlsChange,
      })
    );

    fireEvent.wheel(screen.getByTestId("spectrum-chart"), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 200,
      clientY: 120,
    });

    expect(onPanelControlsChange).toHaveBeenCalled();
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrumYMinDb).toBeGreaterThan(-96);
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrumYMaxDb).toBeLessThanOrEqual(0);
    rectSpy.mockRestore();
  });

  it("updates the chart cursor when ctrl is pressed while hovering", () => {
    renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80" }), {
        historyChartInteractive: true,
      })
    );

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent.pointerMove(chart, { ctrlKey: false });
    expect(chart.style.cursor).toBe("crosshair");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });

    expect(chart.style.cursor).toBe("grab");
  });

  it("returns to live when double-clicking the chart in snapshot mode", () => {
    const setSelectedOffset = vi.fn();
    renderPanel({
      selectedOffset: 2,
      historyChartInteractive: true,
      totalSamples: 3,
      setSelectedOffset,
      resolveSpectrumSnapshotForKey: () => ({
        missing: false,
        path: "M 0 100 L 1000 60",
        pathB: "",
        data: { bands: [], dbList: [-10], dbListB: [] },
      }),
    });

    const chart = screen.getByTestId("spectrum-chart");
    fireEvent.doubleClick(chart);

    expect(setSelectedOffset).toHaveBeenCalledWith(-1);
  });

  it("keeps the frequency axis in a dedicated layout row", () => {
    const { container } = renderPanel({
      displaySpectrumPath: "",
      displaySpectrumPeakPath: "",
      selectedOffset: -1,
      spectrumHover: null,
      onSpectrumHoverMove: vi.fn(),
      onSpectrumHoverLeave: vi.fn(),
    });

    const axisRow = screen.getByText("1k").parentElement?.parentElement;
    const grid = axisRow?.parentElement;
    const chartInset = container.querySelector("svg")?.parentElement?.parentElement;

    expect(grid?.className).toContain("grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)]");
    expect(axisRow?.className).toContain("relative");
    expect(axisRow?.className).not.toContain("absolute");
    expect(axisRow?.className).not.toContain("bottom-0");
    expect(chartInset?.className).not.toContain("min-h-[var(--ui-min-h-history-chart)]");
  });

  it("uses the full chart width without an internal horizontal pad", () => {
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          path: "M 0 120 L 1000 80",
          bandCentersHz: [100, 1000],
          smoothDb: [-30, -20],
        })
      )
    );

    expect(container.innerHTML).not.toContain("--ui-chart-pad");
    expect(container.querySelector("svg")?.parentElement?.className).not.toContain("px-[");
    expect(screen.getByText("1k").parentElement?.className).toContain("inset-0");
  });

  it("keeps frequency axis endpoint labels inside the chart bounds", () => {
    renderPanel(liveAudioData(liveResult()));

    expect(screen.getByText("20").className).toContain("text-left");
    expect(screen.getByText("20").className).not.toContain("-translate-x-1/2");
    expect(screen.getByText("20k").className).toContain("right-0");
    expect(screen.getByText("20k").className).toContain("text-right");
    expect(screen.getByText("20k").className).not.toContain("-translate-x-1/2");
    expect(screen.getByText("1k").className).toContain("-translate-x-1/2");
  });

  it("keeps dB axis endpoint labels inside the chart bounds", () => {
    const { container } = renderPanel(liveAudioData(liveResult()));

    expect(screen.getByText("-12").className).toContain("top-0");
    expect(screen.getByText("-12").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-96").className).toContain("bottom-0");
    expect(screen.getByText("-96").className).not.toContain("-translate-y-1/2");
    expect(
      Array.from(container.querySelectorAll("span")).some((span) =>
        span.className.includes("-translate-y-1/2")
      )
    ).toBe(true);
  });
});

describe("SpectrumPanel Max", () => {
  const LR_KEY = spectrumRequestKeyFromControls({ spectrumView: "lr" });
  const BANDS = [100, 1000];
  const RANGE = {
    minHz: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
    maxHz: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
    yMaxDb: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
    yMinDb: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
  };

  /** The fill is an area path: its upper edge is the contour, and the closing lines follow. */
  function fillEdge(container, plane = "primary") {
    return container.querySelector(`[data-spectrum-max-fill="${plane}"]`)?.getAttribute("d");
  }

  function contourFor(dbList) {
    return buildSpectrumSvgFromBandsAndDb(BANDS, dbList, RANGE);
  }

  function twoFrames(mode, view = "combined", rest = {}) {
    const key = view === "lr" ? LR_KEY : LIVE_KEY;
    const controls = { spectrumMaxMode: mode, spectrumView: view };
    const frame = (smoothDb, smoothDbB) => ({
      selectedOffset: -1,
      panelControls: controls,
      ...rest,
      displayAudio: {
        spectrumResultsByKey: {
          [key]: liveResult({
            bandCentersHz: BANDS,
            smoothDb,
            smoothDbB: smoothDbB ?? [],
            peakDb: [-10, -10],
            peakDbB: smoothDbB ? [-12, -12] : [],
          }),
        },
      },
    });
    const rendered = renderPanel(frame([-30, -50], view === "lr" ? [-35, -55] : undefined));
    rendered.rerender(spectrumPanelTree(frame([-40, -20], view === "lr" ? [-45, -25] : undefined)));
    return rendered;
  }

  it("fills to the cumulative hold in Hold mode", () => {
    const { container } = twoFrames("hold");

    // The maximum of the two frames, which is neither frame on its own.
    expect(fillEdge(container)).toContain(contourFor([-30, -20]));
  });

  it("fills to the engine's decaying peak in Decay mode", () => {
    const { container } = twoFrames("decay");

    expect(fillEdge(container)).toContain(contourFor([-10, -10]));
  });

  it("fills under the live curve with Max off", () => {
    const { container } = twoFrames("off");

    expect(fillEdge(container)).toContain(contourFor([-40, -20]));
  });

  it("holds both curves in L/R", () => {
    const { container } = twoFrames("hold", "lr");

    expect(fillEdge(container, "primary")).toContain(contourFor([-30, -20]));
    expect(fillEdge(container, "secondary")).toContain(contourFor([-35, -25]));
  });

  it("clears the hold when the fill edge is clicked, without capturing a snapshot", () => {
    const captureCurrentSnapshot = vi.fn();
    const { container, rerender } = twoFrames("hold", "lr", {
      captureCurrentSnapshot,
      totalSamples: 10,
    });

    fireEvent.click(container.querySelector('[data-spectrum-max-hold-hit="primary"]'));
    rerender(
      spectrumPanelTree({
        selectedOffset: -1,
        captureCurrentSnapshot,
        totalSamples: 10,
        panelControls: { spectrumMaxMode: "hold", spectrumView: "lr" },
        displayAudio: {
          spectrumResultsByKey: {
            [LR_KEY]: liveResult({
              bandCentersHz: BANDS,
              smoothDb: [-40, -20],
              smoothDbB: [-45, -25],
              peakDb: [-10, -10],
              peakDbB: [-12, -12],
            }),
          },
        },
      })
    );

    expect(captureCurrentSnapshot).not.toHaveBeenCalled();
    // Both planes cleared: the fills now follow the newest frame alone.
    expect(fillEdge(container, "primary")).toContain(contourFor([-40, -20]));
    expect(fillEdge(container, "secondary")).toContain(contourFor([-45, -25]));
  });

  it("offers the clear target only in Hold mode", () => {
    expect(twoFrames("hold").container.querySelector("[data-spectrum-max-hold-hit]")).toBeTruthy();
    expect(twoFrames("decay").container.querySelector("[data-spectrum-max-hold-hit]")).toBeNull();
    expect(twoFrames("off").container.querySelector("[data-spectrum-max-hold-hit]")).toBeNull();
  });
});
