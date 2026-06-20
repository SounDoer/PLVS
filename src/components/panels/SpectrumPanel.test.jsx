/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

describe("SpectrumPanel", () => {
  it("fills up to the peak contour when peak hold is on", () => {
    const peakPath = "M 0 20 L 1000 20";
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPeakPath: peakPath,
      spectrumPeakHold: true,
      selectedOffset: -1,
    });

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(`${peakPath} L 1000 260 L 0 260 Z`);
    // peak hold is now a filled area, not a dashed stroke
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull();
  });

  it("fills up to the live contour when peak hold is off", () => {
    const livePath = "M 0 120 L 1000 80";
    const { container } = renderPanel({
      displaySpectrumPath: livePath,
      displaySpectrumPeakPath: "M 0 20 L 1000 20",
      spectrumPeakHold: false,
      selectedOffset: -1,
    });

    const fill = container.querySelector('path[fill="url(#spectrumFillLive)"]');
    expect(fill?.getAttribute("d")).toBe(`${livePath} L 1000 260 L 0 260 Z`);
  });

  it("fills the secondary peak with the live-b gradient when peak hold is on", () => {
    const peakB = "M 0 30 L 1000 30";
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPathB: "M 0 130 L 1000 90",
      displaySpectrumPeakPathB: peakB,
      spectrumPeakHold: true,
      selectedOffset: -1,
      displaySpectrumData: { bands: [], dbList: [], dbListB: [] },
      spectrumViewLegend: null,
    });

    const fillB = container.querySelector('path[fill="url(#spectrumFillLiveB)"]');
    expect(fillB?.getAttribute("d")).toBe(`${peakB} L 1000 260 L 0 260 Z`);
  });

  it("renders the secondary curve path with the live-b token when displaySpectrumPathB is non-empty", () => {
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPathB: "M 0 130 L 1000 90",
      displaySpectrumPeakPath: "",
      selectedOffset: -1,
      displaySpectrumData: { bands: [], dbList: [], dbListB: [] },
      spectrumViewLegend: null,
    });

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
});
