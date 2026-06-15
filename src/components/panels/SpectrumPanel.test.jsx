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
  it("renders the live peak overlay with the live spectrum token", () => {
    const peakPath = "M 0 20 L 1000 20";
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPeakPath: peakPath,
      spectrumPeakHold: true,
      selectedOffset: -1,
      spectrumHover: null,
      onSpectrumHoverMove: vi.fn(),
      onSpectrumHoverLeave: vi.fn(),
    });

    const peakOverlay = container.querySelector(`path[d="${peakPath}"]`);

    expect(peakOverlay).toBeTruthy();
    expect(peakOverlay?.getAttribute("stroke")).toBe("var(--ui-chart-spectrum-live)");
  });

  it("hides the peak overlay when spectrumPeakHold is off", () => {
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPeakPath: "M 0 20 L 1000 20",
      spectrumPeakHold: false,
      selectedOffset: -1,
    });

    expect(container.querySelector('path[stroke-dasharray="8 6"]')).toBeNull();
  });

  it("renders the secondary peak overlay with the live-b token when peak hold is on", () => {
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPathB: "M 0 130 L 1000 90",
      displaySpectrumPeakPathB: "M 0 30 L 1000 30",
      spectrumPeakHold: true,
      selectedOffset: -1,
      displaySpectrumData: { bands: [], dbList: [], dbListB: [] },
      spectrumViewLegend: null,
    });

    const secondaryPeak = container.querySelector('path[d="M 0 30 L 1000 30"]');
    expect(secondaryPeak).toBeTruthy();
    expect(secondaryPeak?.getAttribute("stroke")).toBe("var(--ui-chart-spectrum-live-b)");
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

    const secondary = container.querySelector('path[stroke="var(--ui-chart-spectrum-live-b)"]');
    expect(secondary).toBeTruthy();
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
