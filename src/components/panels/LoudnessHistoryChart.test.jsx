/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LoudnessHistoryChart } from "./LoudnessHistoryChart.jsx";

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

const baseProps = {
  historyYAxisTicks: [
    { v: -12, lb: "-12" },
    { v: -23, lb: "-23" },
    { v: -36, lb: "-36" },
  ],
  targetLufs: -23,
  hasHistoryData: true,
  historyChartInteractive: true,
  running: false,
  setSelectedOffset: vi.fn(),
  setStatus: vi.fn(),
  holdHistoryHud: vi.fn(),
  showHistoryHud: vi.fn(),
  onHistoryWheel: vi.fn(),
  onHistoryPointerDown: vi.fn(),
  onHistoryPointerMove: vi.fn(),
  onHistoryPointerUp: vi.fn(),
  displayHistoryPathM: "M 0 100 L 600 100",
  displayHistoryPathST: "M 0 120 L 600 120",
  selectedOffset: -1,
  showSelLine: false,
  selLineX: 0,
  isHistoryHudVisible: false,
  clampedWindowSec: 30,
  effectiveOffsetSec: 0,
  historyHover: null,
  historyTimeTicks: ["0s", "15s", "30s"],
  historyTickSteps: 2,
  referenceLufs: -23,
  onHistoryHoverMove: vi.fn(),
  onHistoryHoverLeave: vi.fn(),
};

function renderChart(loudnessHistoryVisibleLayerIds) {
  return render(
    <LoudnessHistoryChart
      {...baseProps}
      loudnessHistoryVisibleLayerIds={loudnessHistoryVisibleLayerIds}
    />
  );
}

describe("LoudnessHistoryChart", () => {
  it("renders the momentary path with an over-gradient stroke when ref is on", () => {
    const { container } = renderChart(["momentary", "ref"]);

    const path = container.querySelector("svg path");
    expect(container.querySelectorAll("svg path")).toHaveLength(1);
    expect(path?.getAttribute("d")).toBe(baseProps.displayHistoryPathM);
    expect(path?.getAttribute("stroke") ?? "").toMatch(/^url\(#/);
    expect(screen.queryByText("Ref -23 LUFS")).toBeNull();
  });

  it("keeps data trace stroke widths independent from SVG scaling", () => {
    const { container } = renderChart(["momentary", "shortTerm"]);
    const paths = container.querySelectorAll("svg path");

    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(paths[1]?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("does not inset the time axis from the chart edges", () => {
    renderChart(["momentary"]);

    expect(screen.getByText("0s").parentElement?.className).toContain("inset-0");
  });

  it("keeps the time axis in a dedicated layout row", () => {
    const { container } = renderChart(["momentary"]);

    const axisRow = screen.getByText("15s").parentElement?.parentElement;
    const grid = axisRow?.parentElement;
    const chartArea = container.querySelector("svg")?.parentElement;

    expect(grid?.className).toContain("grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)]");
    expect(axisRow?.className).toContain("relative");
    expect(axisRow?.className).not.toContain("absolute");
    expect(axisRow?.className).not.toContain("bottom-0");
    expect(chartArea?.className).not.toContain("min-h-[var(--ui-min-h-history-chart)]");
  });

  it("does not color the reference tick as a primary chart trace", () => {
    renderChart(["ref"]);

    const referenceTick = screen.getAllByText("-23").find((element) => element.tagName === "SPAN");
    expect(referenceTick?.className).toContain("font-semibold");
    expect(referenceTick?.className).not.toContain("text-chart-3");
  });

  it("hides reference layer when ref is not selected", () => {
    renderChart(["shortTerm"]);

    expect(screen.queryByText("Ref -23 LUFS")).toBeNull();
  });

  it("shows an empty state when all layers are hidden", () => {
    renderChart([]);

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });

  it("keeps the hover HUD compact without trace swatches", () => {
    render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["momentary", "shortTerm", "ref"]}
        historyHover={{
          leftPct: 30,
          topPct: 40,
          offsetLabel: "12s",
          momentary: -18.2,
          shortTerm: -20.1,
        }}
      />
    );

    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByText("ST")).toBeTruthy();
    expect(screen.queryByLabelText("Momentary trace")).toBeNull();
    expect(screen.queryByLabelText("Short-term trace")).toBeNull();
  });

  it("applies an over-reference gradient stroke to M and ST when the reference layer is on", () => {
    const { container } = renderChart(["momentary", "shortTerm", "ref"]);
    const paths = container.querySelectorAll("svg path");

    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("stroke") ?? "").toMatch(/^url\(#/);
    expect(paths[1]?.getAttribute("stroke") ?? "").toMatch(/^url\(#/);
  });

  it("uses a solid trace stroke when the reference layer is off", () => {
    const { container } = renderChart(["momentary", "shortTerm"]);
    const paths = container.querySelectorAll("svg path");

    expect(paths[0]?.getAttribute("stroke")).toBe("var(--ui-loudness-momentary)");
    expect(paths[1]?.getAttribute("stroke")).toBe("var(--ui-loudness-shortterm)");
  });

  it("keeps the over-reference gradient in snapshot mode", () => {
    const { container } = render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["momentary", "ref"]}
        selectedOffset={5}
      />
    );
    const path = container.querySelector("svg path");

    expect(path?.getAttribute("stroke") ?? "").toMatch(/^url\(#/);
  });

  it("does not render a reference line or tolerance band", () => {
    const { container } = renderChart(["ref"]);

    expect(container.querySelectorAll('[style*="target-line"]')).toHaveLength(0);
  });
});
