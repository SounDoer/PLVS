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
  peakLabelContext: { channelLayout: "auto", resolvedLayout: "unknown" },
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

function renderPanel(value = {}) {
  return render(
    <AudioDataContext.Provider value={{ ...baseAudioData, ...value }}>
      <WaveformPanel />
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
});
