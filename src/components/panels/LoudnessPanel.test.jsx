/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { HistoryDataProvider, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { LoudnessPanel } from "./LoudnessPanel.jsx";
import { LoudnessHistoryIndex } from "../../math/loudnessHistoryIndex.js";

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

function renderPanel(value = {}, props = {}) {
  const { panelControls, ...shared } = value;
  return render(
    <HistoryDataProvider value={{ ...baseAudioData, ...shared }}>
      <PanelInstanceProvider value={{ panelControls }}>
        <LoudnessPanel {...props} />
      </PanelInstanceProvider>
    </HistoryDataProvider>
  );
}

describe("LoudnessPanel", () => {
  it("respects the active panel's visible layers, not the first panel's", () => {
    // The chip writes layer visibility into this panel's own panelControls. The
    // top-level loudnessHistoryVisibleLayerIds reflects the first panel and must
    // not override the per-panel selection.
    renderPanel({
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
      panelControls: { loudnessHistoryVisibleLayerIds: [] },
    });

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });

  it("hides the gestures help button in compact mode", () => {
    renderPanel({}, { compact: true });

    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
  });

  it("treats `ref` as unselected when no profile supplies a reference", () => {
    // Off leaves the layer id in place but nulls the reference, and a layer that can draw
    // nothing must not keep the empty state hidden.
    renderPanel({
      referenceLufs: null,
      panelControls: { loudnessHistoryVisibleLayerIds: ["ref"] },
    });

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });

  it("counts `ref` as a selected layer once a profile supplies a reference", () => {
    renderPanel({
      referenceLufs: -23,
      panelControls: { loudnessHistoryVisibleLayerIds: ["ref"] },
    });

    expect(screen.queryByText("No layers selected")).toBeNull();
  });

  // Regression: once the live history ring fills, its length caps and its reference stays stable
  // (push+shift mutate in place). A path memo keyed only on totalSamples/reference would then freeze
  // even though newer samples keep shifting in. Keying on the newest sample's timestamp keeps the
  // curve advancing. See the memo in LoudnessPanel.jsx.
  it("keeps the loudness path advancing after the history ring fills", () => {
    const capacity = 4;
    // Full ring, mutated in place across ticks exactly like the live intake buffer.
    const histSourceList = [
      { m: -20, st: -21, timestampMs: 1000 },
      { m: -20, st: -21, timestampMs: 1100 },
      { m: -20, st: -21, timestampMs: 1200 },
      { m: -20, st: -21, timestampMs: 1300 },
    ];
    const shared = {
      histSourceList,
      totalSamples: capacity,
      visibleSamples: capacity,
      effectiveOffsetSamples: 0,
    };
    const panelControls = { loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm"] };
    const tree = () => (
      <HistoryDataProvider value={{ ...baseAudioData, ...shared }}>
        <PanelInstanceProvider value={{ panelControls }}>
          <LoudnessPanel />
        </PanelInstanceProvider>
      </HistoryDataProvider>
    );
    const pathsOf = (container) =>
      Array.from(container.querySelectorAll("path[d]"))
        .map((p) => p.getAttribute("d"))
        .join("|");

    const { container, rerender } = render(tree());
    const before = pathsOf(container);

    // One live tick on a FULL ring: drop oldest, append a newer sample at a different level.
    // Length stays at `capacity`, so a memo keyed only on totalSamples would freeze here.
    histSourceList.shift();
    histSourceList.push({ m: -6, st: -8, timestampMs: 1400 });
    rerender(tree());
    const after = pathsOf(container);

    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it("does not scan 144k retained rows for a full-window indexed path", () => {
    const capacity = 144_000;
    const rows = Array.from({ length: capacity }, (_, sequence) => ({
      m: -30 + (sequence % 17),
      st: -32 + (sequence % 19),
      timestampMs: sequence * 100,
    }));
    const loudnessDisplayIndex = new LoudnessHistoryIndex(capacity);
    rows.forEach((row) => loudnessDisplayIndex.append(row));
    let rowReads = 0;
    const histSourceList = {
      length: rows.length,
      rowAt(index) {
        rowReads += 1;
        return rows[index];
      },
    };

    renderPanel({
      histSourceList,
      loudnessDisplayIndex,
      totalSamples: capacity,
      visibleSamples: capacity,
      effectiveOffsetSamples: 0,
      panelControls: { loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm"] },
    });

    expect(rowReads).toBeLessThanOrEqual(4 * 600 + 2);
    expect(loudnessDisplayIndex.batchQueryStats().nodesVisited).toBeLessThanOrEqual(
      600 * (2 * Math.ceil(Math.log2(capacity)) + 2)
    );
  });
});
