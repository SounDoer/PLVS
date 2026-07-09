/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AudioDataContext, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { WaveformPanel } from "./WaveformPanel.jsx";

const { sliceWaveformSubHistoryMock } = vi.hoisted(() => ({
  sliceWaveformSubHistoryMock: vi.fn(() => ({
    mins: [[], []],
    maxes: [[], []],
    bucketCount: 1,
    fracPhase: 0,
    firstBucket: -1,
    lastBucket: -1,
  })),
}));

vi.mock("../../math/waveformMath.js", () => ({
  sliceWaveformSubHistory: sliceWaveformSubHistoryMock,
}));

const baseAudioData = {
  histSourceList: [],
  visibleSamples: 0,
  effectiveOffsetSamples: 0,
  channelCount: 0,
  // Idle context as App provides it: channelCount 0 resolves to stereo (single source of truth).
  peakLabelContext: { channelLayout: "auto", resolvedLayout: "stereo" },
  historyTimeTicks: ["0s", "0s", "0s", "0s", "0s"],
  historyChartInteractive: false,
  selectedOffset: -1,
  selLineX: 0,
  showSelLine: false,
  onHistoryPointerDown: vi.fn(),
  onHistoryPointerMove: vi.fn(),
  onHistoryPointerUp: vi.fn(),
  onHistoryWheel: vi.fn(),
  setSelectedOffset: vi.fn(),
  running: false,
  setStatus: vi.fn(),
  holdHistoryHud: vi.fn(),
  showHistoryHud: vi.fn(),
};

function renderPanel(value = {}, props = {}) {
  return render(waveformPanelTree(value, props));
}

function waveformPanelTree(value = {}, props = {}) {
  const { panelVisible = true, ...shared } = value;
  return (
    <AudioDataContext.Provider value={{ ...baseAudioData, ...shared }}>
      <PanelInstanceProvider value={{ panelVisible }}>
        <WaveformPanel {...props} />
      </PanelInstanceProvider>
    </AudioDataContext.Provider>
  );
}

beforeEach(() => {
  sliceWaveformSubHistoryMock.mockClear();

  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WaveformPanel", () => {
  it("uses stereo labels for idle placeholder lanes", () => {
    renderPanel();

    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.queryByText("Ch 1")).toBeNull();
    expect(screen.queryByText("Ch 2")).toBeNull();
  });

  it("keeps the time axis in a dedicated layout row", () => {
    renderPanel({ historyTimeTicks: ["14s", "11s", "7s", "4s", "0s"] });

    const axisRow = screen.getByText("7s").parentElement?.parentElement;

    expect(axisRow?.className).toContain("shrink-0");
    expect(axisRow?.className).not.toContain("absolute");
    expect(axisRow?.className).not.toContain("bottom-0");
  });

  it("uses the shared chart axis gap between channel labels and waveform charts", () => {
    const { container } = renderPanel();

    const lane = container.querySelector("[data-waveform-lane]");
    const labelRail = lane?.querySelector("[data-waveform-label-rail]");
    const timeAxisRow = screen.getAllByText("0s")[2].parentElement?.parentElement;
    const timeAxisSpacer = container.querySelector("[data-waveform-x-axis-spacer]");
    const interactionOverlay = container.querySelector("[data-waveform-interaction-overlay]");

    expect(labelRail?.className).not.toContain("pr-1");
    expect(container.firstElementChild?.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(labelRail?.className).toContain("w-[var(--ui-w-axis-rail)]");
    expect(lane?.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(timeAxisRow?.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(timeAxisSpacer?.className).toContain("w-[var(--ui-w-axis-rail)]");
    expect(interactionOverlay?.style.left).toBe(
      "calc(var(--ui-w-axis-rail) + var(--ui-chart-axis-gap))"
    );
  });

  it("aligns the latest-edge hint with the waveform chart area", () => {
    const { container } = renderPanel({ effectiveOffsetSamples: 12 });

    const hint = container.querySelector("[data-timeline-latest-edge-hint]");
    expect(hint).toBeTruthy();
    expect(hint?.className).toContain(
      "left-[calc(var(--ui-w-axis-rail)+var(--ui-chart-axis-gap))]"
    );
    expect(screen.queryByText(/Latest/i)).toBeNull();
  });

  it("updates the chart cursor when ctrl is pressed while hovering", () => {
    const { container } = renderPanel({ historyChartInteractive: true });
    const chart = container.querySelector("[data-waveform-interaction-overlay]");

    fireEvent.pointerMove(chart, { ctrlKey: false });
    expect(chart?.style.cursor).toBe("crosshair");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });

    expect(chart?.style.cursor).toBe("grab");
  });

  it("highlights the time axis when time changes elsewhere", () => {
    renderPanel({
      historyTimeAxisActive: true,
      historyTimeTicks: ["14s", "11s", "7s", "4s", "0s"],
    });

    const timeAxis = screen.getByText("7s").parentElement;
    expect(timeAxis?.className).toContain("text-foreground");
    expect(timeAxis?.className).not.toContain("var(--muted)_44%");
  });

  it("hides the gestures help button in compact mode", () => {
    renderPanel({}, { compact: true });

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });

  it("does not recompute waveform buckets for unrelated rerenders", () => {
    const contextValue = { historyTimeTicks: ["14s", "11s", "7s", "4s", "0s"] };
    const { rerender } = render(waveformPanelTree(contextValue));
    expect(sliceWaveformSubHistoryMock).toHaveBeenCalledTimes(1);

    rerender(
      waveformPanelTree({
        ...contextValue,
        historyTimeTicks: ["15s", "11s", "7s", "4s", "0s"],
      })
    );

    expect(sliceWaveformSubHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("does not slice waveform history while the panel instance is hidden", () => {
    renderPanel({ panelVisible: false });

    expect(sliceWaveformSubHistoryMock).not.toHaveBeenCalled();
  });

  it("refreshes the live hover value when waveform buckets change without pointer movement", () => {
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
      height: 120,
      top: 0,
      right: 400,
      bottom: 120,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    });
    sliceWaveformSubHistoryMock.mockImplementation((histSourceList) => {
      const maxL = histSourceList?.[0]?.timestampMs === 1100 ? 1 : 0.5;
      return {
        mins: [[0], [0]],
        maxes: [[maxL], [0.25]],
        bucketCount: 1,
        fracPhase: 0,
        firstBucket: 0,
        lastBucket: 0,
      };
    });

    const { container, rerender } = renderPanel({
      histSourceList: [{ timestampMs: 1000 }],
      visibleSamples: 1,
      channelCount: 2,
      historyChartInteractive: true,
    });
    const chart = container.querySelector("[data-waveform-interaction-overlay]");

    fireEvent(
      chart,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 0,
        clientY: 60,
      })
    );
    expect(screen.getByText("-6.0 dBFS")).toBeTruthy();

    rerender(
      waveformPanelTree({
        histSourceList: [{ timestampMs: 1100 }],
        visibleSamples: 1,
        channelCount: 2,
        historyChartInteractive: true,
      })
    );

    expect(screen.getByText("0.0 dBFS")).toBeTruthy();
  });
});
