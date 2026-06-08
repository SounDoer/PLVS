/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { SpectrogramPanel } from "./SpectrogramPanel.jsx";

vi.mock("../../hooks/useSpectrogramCanvas", () => ({
  useSpectrogramCanvas: vi.fn(),
}));

const baseAudioData = {
  spectrogramSnapRef: { current: [] },
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
  visualSpectrogramSnap: [],
  historyTimeTicks: ["0s", "15s", "30s", "45s", "60s"],
};

function renderPanel(value = {}) {
  return render(
    <AudioDataContext.Provider value={{ ...baseAudioData, ...value }}>
      <SpectrogramPanel />
    </AudioDataContext.Provider>
  );
}

beforeEach(() => {
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
});
