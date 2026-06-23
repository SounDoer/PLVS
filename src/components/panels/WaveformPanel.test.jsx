/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { WaveformPanel } from "./WaveformPanel.jsx";

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
  return render(
    <AudioDataContext.Provider value={{ ...baseAudioData, ...value }}>
      <WaveformPanel {...props} />
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

  it("hides the gestures help button in compact mode", () => {
    renderPanel({}, { compact: true });

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });
});
