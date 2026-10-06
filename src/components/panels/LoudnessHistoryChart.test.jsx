/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LoudnessHistoryChart } from "./LoudnessHistoryChart.jsx";

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = /** @type {any} */ (ResizeObserverStub);
  globalThis.ResizeObserver = /** @type {any} */ (ResizeObserverStub);
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
  plotAreaRef: undefined,
  onLoudnessYRangeChange: undefined,
  historyTimeAxisHandlers: undefined,
  selectionEdge: undefined,
  momentaryRules: undefined,
  shortTermRules: undefined,
  loudnessLayoutKnown: undefined,
};

function renderChart(loudnessHistoryVisibleLayerIds, overrides = {}) {
  return render(
    <LoudnessHistoryChart
      {...baseProps}
      loudnessHistoryVisibleLayerIds={loudnessHistoryVisibleLayerIds}
      {...overrides}
    />
  );
}

describe("LoudnessHistoryChart", () => {
  it("renders only interior Y-axis Grid lines when enabled", () => {
    const { container } = renderChart(["momentary"], {
      gridVisible: true,
      loudnessYMinDb: -36,
      loudnessYMaxDb: -12,
    });
    const grid = container.querySelector("[data-loudness-grid]");

    expect(grid).toBeTruthy();
    expect(grid?.querySelectorAll("line")).toHaveLength(1);
    expect(grid?.querySelector("line")?.getAttribute("stroke")).toBe("var(--ui-loudness-grid)");
  });

  it("does not render a Grid group by default", () => {
    const { container } = renderChart(["momentary"]);
    expect(container.querySelector("[data-loudness-grid]")).toBeNull();
  });

  it("leaves a visible Profile Reference unshadowed by a colliding Grid line", () => {
    const { container } = renderChart(["momentary", "ref"], {
      gridVisible: true,
      loudnessYMinDb: -36,
      loudnessYMaxDb: -12,
    });

    expect(container.querySelector("[data-loudness-grid]")?.querySelectorAll("line")).toHaveLength(
      0
    );
    expect(container.querySelector("[data-testid='loudness-reference-line']")).toBeTruthy();
  });

  it("keeps an enabled Grid in the no-data chart", () => {
    const { container } = renderChart(["momentary"], {
      gridVisible: true,
      hasHistoryData: false,
      historyYAxisTicks: [
        { v: -12, lb: "-12" },
        { v: -18, lb: "-18" },
        { v: -36, lb: "-36" },
      ],
      loudnessYMinDb: -36,
      loudnessYMaxDb: -12,
    });

    expect(container.querySelector("[data-loudness-grid] line")).toBeTruthy();
  });

  it("shows which edge contains a selected sample outside this panel's window", () => {
    renderChart(["momentary"], { selectionEdge: "left" });

    expect(screen.getByTestId("timeline-selection-edge-hint").getAttribute("data-direction")).toBe(
      "left"
    );
  });

  it("renders the momentary path with a plain stroke and draws the reference line when ref is on", () => {
    const { container } = renderChart(["momentary", "ref"]);

    const path = container.querySelector("svg path");
    expect(container.querySelectorAll("svg path")).toHaveLength(1);
    expect(path?.getAttribute("d")).toBe(baseProps.displayHistoryPathM);
    expect(path?.getAttribute("stroke")).toBe("var(--ui-loudness-momentary)");
    const reference = container.querySelector("[data-testid='loudness-reference-line']");
    expect(reference).toBeTruthy();
    expect(reference?.getAttribute("opacity")).toBeNull();
  });

  it("keeps data trace stroke widths independent from SVG scaling", () => {
    renderChart(["momentary", "shortTerm"]);
    const paths = [
      screen.getByTestId("loudness-momentary-path"),
      screen.getByTestId("loudness-short-term-path"),
    ];

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

  it("keeps y-axis endpoint labels inside the chart bounds", () => {
    renderChart(["momentary"]);

    expect(screen.getByText("-12").className).toContain("top-0");
    expect(screen.getByText("-12").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-36").className).toContain("bottom-0");
    expect(screen.getByText("-36").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-23").className).toContain("-translate-y-1/2");
  });

  it("does not color the reference tick as a primary chart trace", () => {
    renderChart(["ref"]);

    const referenceTick = screen.getAllByText("-23").find((element) => element.tagName === "SPAN");
    expect(referenceTick?.className).toContain("font-semibold");
    expect(referenceTick?.className).not.toContain("text-chart-3");
  });

  it("renders adaptive y-axis ticks without a measurement update loop", () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 64,
      height: 220,
      top: 0,
      right: 64,
      bottom: 220,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const { historyYAxisTicks: _historyYAxisTicks, ...props } = baseProps;

    render(
      <LoudnessHistoryChart
        plotAreaRef={undefined}
        onLoudnessYRangeChange={undefined}
        historyTimeAxisHandlers={undefined}
        selectionEdge={undefined}
        shortTermRules={undefined}
        loudnessLayoutKnown={undefined}
        {...props}
        loudnessHistoryVisibleLayerIds={["momentary"]}
      />
    );

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("-64")).toBeTruthy();
    rectSpy.mockRestore();
  });

  it("hides reference layer when ref is not selected", () => {
    renderChart(["shortTerm"]);

    expect(screen.queryByText("Ref -23 LUFS")).toBeNull();
  });

  it("shows an empty state when all layers are hidden", () => {
    renderChart([]);

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });

  it("updates the chart cursor when ctrl is pressed while hovering", () => {
    const { container } = renderChart(["momentary"]);
    const chart = container.querySelector("svg")?.parentElement;

    fireEvent.pointerMove(chart, { ctrlKey: false });
    expect(chart?.style.cursor).toBe("crosshair");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });

    expect(chart?.style.cursor).toBe("grab");
  });

  it("highlights the y axis when chart ctrl wheel changes the y range", () => {
    const onLoudnessYRangeChange = vi.fn();
    const { container } = render(
      <LoudnessHistoryChart
        {...baseProps}
        onLoudnessYRangeChange={onLoudnessYRangeChange}
        loudnessHistoryVisibleLayerIds={["momentary"]}
      />
    );
    const chart = container.querySelector("svg")?.parentElement;

    fireEvent.wheel(chart, {
      ctrlKey: true,
      deltaY: -100,
      clientY: 100,
    });

    const yAxis = screen.getByText("-12").parentElement?.parentElement;
    expect(onLoudnessYRangeChange).toHaveBeenCalled();
    expect(yAxis?.className).toContain("text-foreground");
    expect(yAxis?.className).not.toContain("var(--muted)_44%");
  });

  it("highlights the time axis when time changes elsewhere", () => {
    render(
      <LoudnessHistoryChart
        {...baseProps}
        isTimeAxisActive
        loudnessHistoryVisibleLayerIds={["momentary"]}
      />
    );

    const timeAxis = screen.getByText("15s").parentElement?.parentElement;
    expect(timeAxis?.className).toContain("text-foreground");
    expect(timeAxis?.className).not.toContain("var(--muted)_44%");
  });

  it("shows the latest-edge visual hint without adding label text", () => {
    const { container, rerender } = render(
      <LoudnessHistoryChart
        {...baseProps}
        showLatestEdgeHint
        loudnessHistoryVisibleLayerIds={["momentary"]}
      />
    );

    expect(container.querySelector("[data-timeline-latest-edge-hint]")).toBeTruthy();
    expect(screen.queryByText(/Latest/i)).toBeNull();

    rerender(
      <LoudnessHistoryChart
        {...baseProps}
        showLatestEdgeHint={false}
        loudnessHistoryVisibleLayerIds={["momentary"]}
      />
    );

    expect(container.querySelector("[data-timeline-latest-edge-hint]")).toBeNull();
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

  it("draws plain M and ST strokes plus a reference line when the reference layer is on", () => {
    renderChart(["momentary", "shortTerm", "ref"]);
    const momentary = screen.getByTestId("loudness-momentary-path");
    const shortTerm = screen.getByTestId("loudness-short-term-path");

    expect(momentary.getAttribute("stroke")).toBe("var(--ui-loudness-momentary)");
    expect(shortTerm.getAttribute("stroke")).toBe("var(--ui-loudness-shortterm)");
    expect(screen.getByTestId("loudness-reference-line")).toBeTruthy();
  });

  it("draws no reference line when the reference layer is off", () => {
    renderChart(["momentary", "shortTerm"]);

    expect(screen.getByTestId("loudness-momentary-path").getAttribute("stroke")).toBe(
      "var(--ui-loudness-momentary)"
    );
    expect(screen.getByTestId("loudness-short-term-path").getAttribute("stroke")).toBe(
      "var(--ui-loudness-shortterm)"
    );
    expect(screen.queryByTestId("loudness-reference-line")).toBeNull();
  });

  it("stacks Reference below Short-term below Momentary", () => {
    renderChart(["momentary", "shortTerm", "ref"]);
    const svg = screen.getByTestId("loudness-reference-line").closest("svg");
    const paintedLayers = Array.from(svg.children)
      .map((node) => node.getAttribute("data-testid"))
      .filter(Boolean);

    expect(paintedLayers).toEqual([
      "loudness-reference-line",
      "loudness-short-term-path",
      "loudness-momentary-path",
    ]);
  });

  it("keeps a plain snapshot stroke and still draws the reference line in snapshot mode", () => {
    const { container } = render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["momentary", "ref"]}
        selectedOffset={5}
      />
    );
    const path = container.querySelector("svg path");

    expect(path?.getAttribute("stroke")).toBe("var(--ui-loudness-momentary-snap)");
    expect(container.querySelector("[data-testid='loudness-reference-line']")).toBeTruthy();
  });

  it("tints the momentary trace with a gradient when its own rule breaches", () => {
    const { container } = render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["momentary"]}
        momentaryRules={[{ metricId: "momentary", op: ">", value: -10, severity: "fail" }]}
      />
    );
    const path = container.querySelector("svg path");
    expect(path?.getAttribute("stroke") ?? "").toMatch(/^url\(#/);
    expect(container.querySelector("linearGradient")).toBeTruthy();
  });

  it("keeps the momentary trace plain when it has no rules", () => {
    const { container } = render(
      <LoudnessHistoryChart {...baseProps} loudnessHistoryVisibleLayerIds={["momentary"]} />
    );
    expect(container.querySelector("svg path")?.getAttribute("stroke")).toBe(
      "var(--ui-loudness-momentary)"
    );
  });

  it("does not render a reference line or tolerance band", () => {
    const { container } = renderChart(["ref"]);

    expect(container.querySelectorAll('[style*="target-line"]')).toHaveLength(0);
  });
});
