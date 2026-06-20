/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { LoudnessPanel } from "./LoudnessPanel.jsx";

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

const baseAudioData = {
  historyYAxisTicks: [
    { v: -12, lb: "-12" },
    { v: -23, lb: "-23" },
    { v: -36, lb: "-36" },
  ],
  targetLufs: -23,
  referenceLufs: -23,
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
  historyTimeTicks: ["0s", "15s", "30s"],
  histSourceList: [],
  effectiveOffsetSamples: 0,
  visibleSamples: 0,
};

describe("LoudnessPanel", () => {
  it("respects the active panel's visible layers, not the first panel's", () => {
    // The chip writes layer visibility into this panel's own panelControls. The
    // top-level loudnessHistoryVisibleLayerIds reflects the first panel and must
    // not override the per-panel selection.
    render(
      <AudioDataContext.Provider
        value={{
          ...baseAudioData,
          loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
          panelControls: { loudnessHistoryVisibleLayerIds: [] },
        }}
      >
        <LoudnessPanel />
      </AudioDataContext.Provider>
    );

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });
});
