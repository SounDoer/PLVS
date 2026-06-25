/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { SpectrumPanel } from "./SpectrumPanel.jsx";

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
  return render(
    <AudioDataContext.Provider value={audioData}>
      <SpectrumPanel />
    </AudioDataContext.Provider>
  );
}

// Default panel controls resolve to this live request key (pair 0/1, combined view).
const LIVE_KEY = "spectrum:pair:0:1:combined:sm50:tilt450";

function liveResult(over = {}) {
  return {
    path: "",
    peakPath: "",
    pathB: "",
    peakPathB: "",
    bandCentersHz: [],
    smoothDb: [],
    smoothDbB: [],
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

describe("SpectrumPanel", () => {
  it("fills up to the peak contour when peak hold is on", () => {
    const peakPath = "M 0 20 L 1000 20";
    const { container } = renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80", peakPath }), {
        panelControls: { spectrumPeakHold: true },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(`${peakPath} L 1000 260 L 0 260 Z`);
    // peak hold is now a filled area, not a dashed stroke
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull();
  });

  it("uses the active panel's peak-hold setting, not the first panel's", () => {
    const peakPath = "M 0 20 L 1000 20";
    const livePath = "M 0 120 L 1000 80";
    // Global (first panel) has peak hold on, but this panel's own control has it off.
    const { container } = renderPanel(
      liveAudioData(liveResult({ path: livePath, peakPath }), {
        spectrumPeakHold: true,
        panelControls: { spectrumPeakHold: false },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(`${livePath} L 1000 260 L 0 260 Z`);
  });

  it("fills up to the live contour when peak hold is off", () => {
    const livePath = "M 0 120 L 1000 80";
    const { container } = renderPanel(
      liveAudioData(liveResult({ path: livePath, peakPath: "M 0 20 L 1000 20" }), {
        panelControls: { spectrumPeakHold: false },
      })
    );

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(`${livePath} L 1000 260 L 0 260 Z`);
  });

  it("fills the secondary peak with the live-b gradient when peak hold is on", () => {
    const peakB = "M 0 30 L 1000 30";
    const { container } = renderPanel(
      liveAudioData(
        liveResult({
          path: "M 0 120 L 1000 80",
          pathB: "M 0 130 L 1000 90",
          peakPathB: peakB,
        }),
        { panelControls: { spectrumPeakHold: true }, spectrumViewLegend: null }
      )
    );

    const fillB = container.querySelector('path[fill="url(#spectrumFillLiveB)"]');
    expect(fillB?.getAttribute("d")).toBe(`${peakB} L 1000 260 L 0 260 Z`);
  });

  it("renders the secondary curve path with the live-b token when the result has a B path", () => {
    const { container } = renderPanel(
      liveAudioData(liveResult({ path: "M 0 120 L 1000 80", pathB: "M 0 130 L 1000 90" }), {
        spectrumViewLegend: null,
      })
    );

    const secondary = container.querySelector('path[stroke="var(--ui-spectrum-secondary)"]');
    expect(secondary).toBeTruthy();
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
    const path = "M 0 100 L 1000 60";
    const { container } = renderPanel({
      selectedOffset: 2,
      resolveSpectrumSnapshotForKey: () => ({
        missing: false,
        path,
        pathB: "",
        data: { bands: [], dbList: [-10], dbListB: [] },
      }),
    });

    const snapStroke = container.querySelector('path[stroke="var(--ui-spectrum-primary-snap)"]');
    expect(snapStroke?.getAttribute("d")).toBe(path);
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
    expect(screen.getByText("1k").parentElement?.className).toContain("inset-x-0");
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
    renderPanel(liveAudioData(liveResult()));

    expect(screen.getByText("0").className).toContain("top-0");
    expect(screen.getByText("0").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-80").className).toContain("bottom-0");
    expect(screen.getByText("-80").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-40").className).toContain("-translate-y-1/2");
  });
});
