/** @vitest-environment jsdom */
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { dockVectorscopeKey } from "../dockAnalysisRequest.js";
import { DockVectorscope } from "./DockVectorscope.jsx";

const controls = {
  vectorscopePair: { x: 0, y: 1 },
  vectorscopeMode: "lissajous",
  vectorscopePolarLevelMaxHold: false,
};
const key = dockVectorscopeKey(controls);

function slab(rows) {
  return {
    length: rows.length,
    timestampAt: (index) => rows[index].timestampMs,
    rowAt: (index) => rows[index],
  };
}

function renderWith(
  result,
  peakDb = [-12, -10],
  heightMode = "standard",
  selectedControls = controls,
  historyData = {}
) {
  return render(dockVectorscopeTree(result, peakDb, heightMode, selectedControls, historyData));
}

function dockVectorscopeTree(
  result,
  peakDb = [-12, -10],
  heightMode = "standard",
  selectedControls = controls,
  historyData = {}
) {
  return (
    <FrameDataProvider
      value={{
        channelCount: 2,
        displayAudio: {
          peakDb,
          vectorscopeResultsByKey: result ? { [key]: result } : {},
        },
      }}
    >
      <HistoryDataProvider value={historyData}>
        <DockVectorscope
          controls={
            /** @type {import("../dockModuleControls.js").DockModuleProps<"correlation">} */ (
              selectedControls
            )
          }
          heightMode={heightMode}
        />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("DockVectorscope shared panel", () => {
  it.each(["standard", "expanded"])(
    "uses the normal vertical layout at %s height",
    (heightMode) => {
      const { container } = renderWith(
        { path: "M 0 0 L 2 2", correlation: 0.5 },
        undefined,
        heightMode
      );
      const stage = container.querySelector("[data-vectorscope-plot-stage]");
      const rail = container.querySelector("[data-vectorscope-correlation-rail]");
      expect(stage).toBeTruthy();
      expect(rail.parentElement).toBe(stage.parentElement);
      expect(stage.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector("[data-vectorscope-correlation-axis]")).toBeTruthy();
      expect(container.textContent).not.toMatch(/Corr/);
      expect(
        container.querySelector("[data-vectorscope-correlation-marker]").getAttribute("style")
      ).toContain("75%");
      expect(container.querySelector("svg path[d='M 0 0 L 2 2']")).toBeTruthy();
    }
  );

  it.each(["polarSample", "polarLevel"])("uses the shared %s plot", (mode) => {
    const getVectorscopeHistoryForKey = vi.fn(() =>
      slab([{ timestampMs: 1000, pairs: [0.5, -0.5] }])
    );
    const { container } = renderWith(
      { correlation: 0.5 },
      undefined,
      "standard",
      { ...controls, vectorscopeMode: mode },
      { getVectorscopeHistoryForKey }
    );
    expect(container.querySelector(`[data-vectorscope-polar="${mode}"]`)).toBeTruthy();
    expect(getVectorscopeHistoryForKey).toHaveBeenCalledWith(key);
  });

  it("retains Hold Slow and releases the persistence layer", () => {
    vi.useFakeTimers();
    try {
      const getVectorscopeHistoryForKey = () =>
        slab([
          { timestampMs: 980, pairs: [0.4, -0.4] },
          { timestampMs: 1000, pairs: [0.5, -0.5] },
        ]);
      const { container } = renderWith(
        { path: "M 0 0 L 2 2", correlation: 0.5 },
        undefined,
        "standard",
        controls,
        { selectedOffset: -1, historyChartInteractive: true, getVectorscopeHistoryForKey }
      );
      const plot = container.querySelector("[data-vectorscope-plot]");
      fireEvent(
        plot,
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 })
      );
      act(() => vi.advanceTimersByTime(300));
      expect(container.querySelector("[data-vectorscope-persistence]")).toBeTruthy();
      fireEvent.pointerUp(plot);
      expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses exact frozen correlation without reading live history", () => {
    const getVectorscopeHistoryForKey = vi.fn();
    const { container } = renderWith({ correlation: 1 }, undefined, "standard", controls, {
      selectedOffset: 0,
      getVectorscopeHistoryForKey,
      resolveVectorscopeSnapshotForKey: () => ({
        path: "M 1 2 L 3 4",
        correlation: -0.75,
        hasSignal: true,
      }),
    });
    expect(
      container.querySelector("[data-vectorscope-correlation-marker]").getAttribute("style")
    ).toContain("12.5%");
    expect(container.querySelector("svg path[d='M 1 2 L 3 4']")).toBeTruthy();
    expect(getVectorscopeHistoryForKey).not.toHaveBeenCalled();
  });
});
