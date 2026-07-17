/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  FrameDataProvider,
  HistoryDataProvider,
  PanelInstanceProvider,
} from "../../workspace/AudioDataContext.jsx";
import { VectorscopePanel } from "./VectorscopePanel.jsx";

function renderPanel(audioData) {
  return render(vectorscopePanelTree(audioData));
}

function vectorscopePanelTree(audioData) {
  const {
    panelControls,
    analysisStatus,
    vsGridDiagInset,
    vsGridDiagFar,
    correlation,
    channelCount,
    peakLabelContext,
    vectorscopePairX,
    vectorscopePairY,
    displayAudio,
    ...historyData
  } = audioData;
  return (
    <FrameDataProvider
      value={{
        vsGridDiagInset,
        vsGridDiagFar,
        correlation,
        channelCount,
        peakLabelContext,
        vectorscopePairX,
        vectorscopePairY,
        displayAudio,
      }}
    >
      <HistoryDataProvider value={historyData}>
        <PanelInstanceProvider value={{ panelControls, analysisStatus }}>
          <VectorscopePanel />
        </PanelInstanceProvider>
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("VectorscopePanel", () => {
  it("keeps the trace stroke width independent from SVG scaling", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": { path: "M 0 0 L 100 100", correlation: 0.7, pairX: 0, pairY: 1 },
        },
      },
    });

    const trace = container.querySelector('path[stroke="var(--ui-vectorscope-trace)"]');
    expect(trace?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(trace?.getAttribute("stroke-width")).toBe("var(--ui-vectorscope-stroke-width)");
  });

  it("shows the no-data empty state when its request has no history at the selected time", () => {
    renderPanel({
      selectedOffset: 2,
      resolveVectorscopeSnapshotForKey: () => ({ missing: true, path: "", correlation: -Infinity }),
    });

    expect(screen.getByText("No data for this view at selected time")).toBeTruthy();
  });

  it("shows the over-cap empty state when its request is over the active cap", () => {
    renderPanel({ selectedOffset: -1, analysisStatus: "overCap" });

    expect(screen.getByText("Too many active analysis views")).toBeTruthy();
  });

  it("renders its own request key's snapshot trace in snapshot mode", () => {
    const path = "M 10 10 L 250 250";
    const { container } = renderPanel({
      selectedOffset: 2,
      resolveVectorscopeSnapshotForKey: () => ({ missing: false, path, correlation: 0.5 }),
    });

    const trace = container.querySelector('path[stroke="var(--ui-vectorscope-trace-snap)"]');
    expect(trace?.getAttribute("d")).toBe(path);
  });

  it("keeps snapshot display data from changing the panel's live pair selection", () => {
    renderPanel({
      selectedOffset: 2,
      channelCount: 4,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: { vectorscopePairX: 2, vectorscopePairY: 3 },
      resolveVectorscopeSnapshotForKey: () => ({
        missing: false,
        path: "M 10 10 L 250 250",
        correlation: 0.5,
      }),
    });

    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.queryByText("C")).toBeNull();
    expect(screen.queryByText("LFE")).toBeNull();
  });

  it("reads the request-keyed live result in live mode", () => {
    const path = "M 0 0 L 100 100";
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": { path, correlation: 0.7, pairX: 0, pairY: 1 },
        },
      },
    });

    const trace = container.querySelector('path[stroke="var(--ui-vectorscope-trace)"]');
    expect(trace?.getAttribute("d")).toBe(path);
  });

  it("renders a persistent correlation rail instead of the numeric footer", () => {
    const { container } = renderPanel({ selectedOffset: -1, panelControls: {} });

    const rail = container.querySelector("[data-vectorscope-correlation-rail]");
    const axis = container.querySelector("[data-vectorscope-correlation-axis]");

    expect(rail).toBeTruthy();
    expect(axis).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(rail?.className).toContain("h-3");
    expect(rail?.className).toContain("mt-[var(--ui-chart-axis-gap)]");
    expect(axis?.className).toContain("h-[var(--ui-chart-x-axis-row-h)]");
    expect(axis?.className).toContain("mt-[var(--ui-chart-axis-gap)]");
    expect(axis?.innerHTML).toContain("absolute top-0 whitespace-nowrap");
    expect(screen.getByText("0").getAttribute("style")).toContain("left: 50%");
    expect(container.querySelector("[data-vectorscope-footer]")).toBeNull();
  });

  it("does not auto-hide the correlation rail in narrow panes", () => {
    const { container } = renderPanel({ selectedOffset: -1, panelControls: {} });

    const rail = container.querySelector("[data-vectorscope-correlation-rail]");

    expect(rail?.className).not.toContain("@max-[220px]:hidden");
  });

  it("places the rail marker from correlation when the selected pair has signal", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": { path: "M 0 0 L 100 100", correlation: 0.5, pairX: 0, pairY: 1 },
        },
      },
    });

    const marker = container.querySelector("[data-vectorscope-correlation-marker]");
    expect(marker).toBeTruthy();
    expect(marker?.getAttribute("style")).toContain("left: 75%");
    expect(marker?.className).not.toContain("currentColor");
    expect(marker?.className).not.toContain("shadow-[");
  });

  it("does not render a fixed center dot over the trace", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": {
            path: "M 0 0 L 100 100",
            correlation: 0.5,
            pairX: 0,
            pairY: 1,
          },
        },
      },
    });

    expect(container.querySelector('circle[cx="130"][cy="130"]')).toBeNull();
  });

  it("smooths the live marker position and color but leaves snapshot markers immediate", () => {
    const { container, rerender } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": { path: "M 0 0 L 100 100", correlation: -1, pairX: 0, pairY: 1 },
        },
      },
    });
    rerender(
      vectorscopePanelTree({
        selectedOffset: -1,
        panelControls: { vectorscopePair: { x: 0, y: 1 } },
        displayAudio: {
          peakDb: [-12, -18],
          vectorscopeResultsByKey: {
            "vectorscope:pair:0:1": {
              path: "M 0 0 L 100 100",
              correlation: 1,
              pairX: 0,
              pairY: 1,
            },
          },
        },
      })
    );
    const liveMarker = container.querySelector("[data-vectorscope-correlation-marker]");
    expect(liveMarker?.className).toContain("transition-[left,background-color]");
    expect(liveMarker?.getAttribute("style")).toContain("left: 25%");
    expect(liveMarker?.className).toContain("bg-[color:var(--ui-signal-bad)]");

    const snapshot = renderPanel({
      selectedOffset: 2,
      displayAudio: { peakDb: [-12, -18] },
      resolveVectorscopeSnapshotForKey: () => ({
        missing: false,
        path: "M 0 0 L 100 100",
        correlation: 0.5,
        hasSignal: true,
      }),
    });
    expect(
      snapshot.container.querySelector("[data-vectorscope-correlation-marker]")?.className
    ).not.toContain("transition-[left,background-color]");
  });

  it("treats no-signal correlation as indeterminate instead of placing the rail marker at zero", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        peakDb: [-Infinity, -Infinity],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": {
            path: "M 130 130 L 130 130",
            correlation: 0,
            pairX: 0,
            pairY: 1,
          },
        },
      },
    });

    expect(container.querySelector("[data-vectorscope-correlation-marker]")).toBeNull();
  });

  it("does not render the removed M/S energy cross", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 }, vectorscopeEnergyCross: true },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": {
            path: "M 0 0 L 100 100",
            correlation: 0.5,
            midEnergy: 0.4,
            sideEnergy: 0.2,
            pairX: 0,
            pairY: 1,
          },
        },
      },
    });

    expect(container.querySelector("[data-vectorscope-energy-cross]")).toBeNull();
  });

  it("does not render the removed trace hold layer", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 }, vectorscopeTraceHold: true },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": {
            path: "M 0 0 L 100 100",
            correlation: 0.5,
            pairX: 0,
            pairY: 1,
          },
        },
      },
    });

    expect(container.querySelector("[data-vectorscope-trace-hold]")).toBeNull();
  });
});

function holdAudioData(path, correlation = 0.5, overrides = {}) {
  return {
    selectedOffset: -1,
    historyChartInteractive: true,
    panelControls: { vectorscopePair: { x: 0, y: 1 } },
    displayAudio: {
      peakDb: [-12, -18],
      vectorscopeResultsByKey: {
        "vectorscope:pair:0:1": { path, correlation, pairX: 0, pairY: 1 },
      },
    },
    ...overrides,
  };
}

function lastLiveTrace(container) {
  const traces = container.querySelectorAll('path[stroke="var(--ui-vectorscope-trace)"]');
  return traces[traces.length - 1] ?? null;
}

function fakeVectorscopeSlab(rows) {
  return {
    length: rows.length,
    timestampAt: (i) => rows[i]?.timestampMs ?? NaN,
    rowAt: (i) => rows[i],
  };
}

function persistenceAccessor() {
  return fakeVectorscopeSlab([
    { pairs: [0.1, 0.1], timestampMs: 1000 },
    { pairs: [0.2, 0.2], timestampMs: 1040 },
  ]);
}

describe("VectorscopePanel hold slow mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function activateHold(container) {
    const plot = container.querySelector("[data-vectorscope-plot]");
    fireEvent(
      plot,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 50 })
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    return plot;
  }

  it("shows the persistence layer and hides the live path while held", () => {
    vi.useFakeTimers();
    const { container } = renderPanel(
      holdAudioData("M 0 0 L 10 10", 0.5, {
        getVectorscopeHistoryForKey: persistenceAccessor,
      })
    );
    expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();

    activateHold(container);
    expect(container.querySelector("[data-vectorscope-persistence]")).toBeTruthy();
    expect(lastLiveTrace(container)).toBeNull();
  });

  it("removes the persistence layer and restores the live path on release", () => {
    vi.useFakeTimers();
    const { container } = renderPanel(
      holdAudioData("M 0 0 L 10 10", 0.5, {
        getVectorscopeHistoryForKey: persistenceAccessor,
      })
    );
    const plot = activateHold(container);

    fireEvent(plot, new MouseEvent("pointerup", { bubbles: true }));
    expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 0 0 L 10 10");
  });

  it("falls back to the live trace while held when history is unavailable", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    activateHold(container);

    expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();
    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });

  it("cancels hold activation when the pointer moves beyond the threshold", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    const plot = container.querySelector("[data-vectorscope-plot]");
    fireEvent(
      plot,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 50 })
    );
    fireEvent(plot, new MouseEvent("pointermove", { bubbles: true, clientX: 60, clientY: 50 }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });

  it("does not activate when history is not interactive", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(
      holdAudioData("M 0 0 L 10 10", 0.5, { historyChartInteractive: false })
    );
    activateHold(container);

    rerender(
      vectorscopePanelTree(holdAudioData("M 1 1 L 11 11", 0.5, { historyChartInteractive: false }))
    );
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });

  it("does not activate in snapshot mode", () => {
    vi.useFakeTimers();
    const snapshotData = {
      selectedOffset: 2,
      historyChartInteractive: true,
      resolveVectorscopeSnapshotForKey: () => ({
        missing: false,
        path: "M 5 5 L 15 15",
        correlation: 0.5,
        hasSignal: true,
      }),
    };
    const { container } = renderPanel(snapshotData);
    activateHold(container);

    const snapTrace = container.querySelector('path[stroke="var(--ui-vectorscope-trace-snap)"]');
    expect(snapTrace?.getAttribute("d")).toBe("M 5 5 L 15 15");
  });

  it("smooths the correlation marker while held", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10", -1));
    activateHold(container);

    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11", 1)));
    const marker = container.querySelector("[data-vectorscope-correlation-marker]");
    // Hold alpha 0.06 then live display alpha 0.25: -1 -> -0.97 -> left 1.5%
    // (an unsmoothed jump to +1 would land at 25% through the live alpha alone).
    expect(marker?.getAttribute("style")).toContain("left: 1.5");
  });

  it("restores per-frame updates on pointer up", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    const plot = activateHold(container);

    fireEvent(plot, new MouseEvent("pointerup", { bubbles: true }));
    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });
});
