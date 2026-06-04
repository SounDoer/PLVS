/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LoudnessHistoryChart } from "./LoudnessHistoryChart.jsx";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
  motion: {
    div: React.forwardRef(function MotionDiv(
      { initial: _initial, animate: _animate, transition: _transition, ...props },
      ref
    ) {
      return <div ref={ref} {...props} />;
    }),
  },
}));

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
  it("renders selected paths and reference layer", () => {
    const { container } = renderChart(["momentary", "ref"]);

    expect(container.querySelectorAll("svg path")).toHaveLength(1);
    expect(container.querySelector("svg path")?.getAttribute("d")).toBe(
      baseProps.displayHistoryPathM
    );
    expect(screen.getByText("Ref -23 LUFS")).toBeTruthy();
  });

  it("hides reference layer when ref is not selected", () => {
    renderChart(["shortTerm"]);

    expect(screen.queryByText("Ref -23 LUFS")).toBeNull();
  });

  it("shows an empty state when all layers are hidden", () => {
    renderChart([]);

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });
});
