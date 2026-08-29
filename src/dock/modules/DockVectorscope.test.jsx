/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
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
        <DockVectorscope controls={selectedControls} heightMode={heightMode} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("DockVectorscope", () => {
  it("renders the keyed vector path and correlation readout", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 72,
      top: 0,
      right: 220,
      bottom: 72,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith({ path: "M 0 0 L 260 260", correlation: 0.5, pairX: 0, pairY: 1 });
    expect(screen.getByTestId("dock-vectorscope-trace").getAttribute("d")).toBe("M 0 0 L 260 260");
    expect(screen.getByText("+0.50")).toBeTruthy();
    expect(screen.getByTestId("dock-vectorscope-correlation-marker").style.left).toBe("75%");
    expect(screen.getByText("L").parentElement?.className).toContain("var(--ui-dock-fs-label)");
    expect(screen.getByText("-1").parentElement?.className).toContain("var(--ui-dock-fs-caption)");
    expect(screen.getByText("+0.50").className).toContain("var(--ui-dock-fs-value)");
    expect(screen.getByTestId("dock-vectorscope-correlation-readout").textContent).toBe(
      "Corr+0.50"
    );
    rect.mockRestore();
  });

  it("renders an indeterminate correlation without a keyed result", () => {
    renderWith(null);
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByTestId("dock-vectorscope-trace")).toBeNull();
    expect(screen.queryByTestId("dock-vectorscope-correlation-marker")).toBeNull();
  });

  it("stacks a full-width correlation axis below the plot in Expanded mode", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 152,
      top: 0,
      right: 220,
      bottom: 152,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith(
      { path: "M 0 0 L 260 260", correlation: 0.5, pairX: 0, pairY: 1 },
      undefined,
      "expanded"
    );

    expect(screen.getByTestId("dock-vectorscope-plot").parentElement?.dataset.layout).toBe(
      "expanded"
    );
    expect(screen.getByText("Correlation")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByTestId("dock-vectorscope-correlation-rail").className).toContain("w-full");
    const rail = screen.getByTestId("dock-vectorscope-correlation-rail");
    const readout = screen.getByText("Correlation").parentElement;
    expect(readout.className).toContain("justify-center");
    expect(rail.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rect.mockRestore();
  });

  it("keeps the abbreviated correlation label when Expanded width is narrow", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 152,
      top: 0,
      right: 160,
      bottom: 152,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith(
      { path: "M 0 0 L 260 260", correlation: 0.5, pairX: 0, pairY: 1 },
      undefined,
      "expanded"
    );

    expect(screen.getByTestId("dock-vectorscope-correlation-readout").textContent).toBe(
      "Corr+0.50"
    );
    expect(screen.queryByText("Correlation")).toBeNull();
    rect.mockRestore();
  });

  it("hides the marker during silence despite finite correlation", () => {
    renderWith({ path: "M 20 20", correlation: 0, pairX: 0, pairY: 1 }, [-Infinity, -Infinity]);
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByTestId("dock-vectorscope-correlation-marker")).toBeNull();
  });

  it.each([
    ["polarSample", false],
    ["polarLevel", true],
  ])("renders %s from the keyed history slab", (vectorscopeMode, vectorscopePolarLevelMaxHold) => {
    const getVectorscopeHistoryForKey = vi.fn(() =>
      slab([{ timestampMs: 1000, pairs: [0.5, -0.5] }])
    );
    renderWith(
      { path: "M 0 0", correlation: 0.25, pairX: 0, pairY: 1 },
      undefined,
      "standard",
      { ...controls, vectorscopeMode, vectorscopePolarLevelMaxHold },
      { getVectorscopeHistoryForKey, vectorscopeResetEpoch: 2 }
    );

    expect(document.querySelector(`[data-vectorscope-polar="${vectorscopeMode}"]`)).toBeTruthy();
    expect(screen.queryByTestId("dock-vectorscope-trace")).toBeNull();
    expect(getVectorscopeHistoryForKey).toHaveBeenCalledWith(key);
    expect(screen.getByTestId("dock-vectorscope-correlation-rail")).toBeTruthy();
  });

  it("reuses the decoded Dock polar window until the history slab version changes", () => {
    const rows = [
      { timestampMs: 100, pairs: [0.5, -0.5] },
      { timestampMs: 140, pairs: [0.6, -0.6] },
    ];
    const historySlab = {
      version: 1,
      length: rows.length,
      timestampAt: (index) => rows[index]?.timestampMs ?? NaN,
      rowAt: vi.fn((index) => rows[index]),
    };
    const selectedControls = { ...controls, vectorscopeMode: "polarSample" };
    const historyData = { getVectorscopeHistoryForKey: () => historySlab };
    const result = { path: "M 0 0", correlation: 0.25, pairX: 0, pairY: 1 };
    const { rerender } = renderWith(result, undefined, "standard", selectedControls, historyData);
    const callsAfterFirstRender = historySlab.rowAt.mock.calls.length;

    rerender(dockVectorscopeTree(result, undefined, "standard", selectedControls, historyData));
    expect(historySlab.rowAt).toHaveBeenCalledTimes(callsAfterFirstRender);

    historySlab.version = 2;
    rerender(dockVectorscopeTree(result, undefined, "standard", selectedControls, historyData));
    expect(historySlab.rowAt.mock.calls.length).toBeGreaterThan(callsAfterFirstRender);
  });

  it.each(["lissajous", "polarSample", "polarLevel"])(
    "uses Dock-owned pair labels in %s mode",
    (vectorscopeMode) => {
      const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 220,
        height: 72,
        top: 0,
        right: 220,
        bottom: 72,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      renderWith(null, [-12, -10], "standard", {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode,
        vectorscopePolarLevelMaxHold: false,
      });

      const pairLabels = screen.getByTestId("dock-vectorscope-pair-labels");
      expect(pairLabels.className).toContain("var(--ui-dock-fs-label)");
      if (vectorscopeMode !== "lissajous") {
        expect(document.querySelector("[data-vectorscope-polar] > span")).toBeNull();
      }
      rect.mockRestore();
    }
  );

  it.each(["lissajous", "polarSample", "polarLevel"])(
    "uses the same available-height boundary for pair labels in %s mode",
    (vectorscopeMode) => {
      const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
      rect.mockReturnValue({
        width: 220,
        height: 43,
        top: 0,
        right: 220,
        bottom: 43,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      const hidden = renderWith(null, [-12, -10], "standard", {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode,
        vectorscopePolarLevelMaxHold: false,
      });
      expect(screen.queryByTestId("dock-vectorscope-pair-labels")).toBeNull();
      hidden.unmount();

      rect.mockReturnValue({
        width: 220,
        height: 44,
        top: 0,
        right: 220,
        bottom: 44,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      renderWith(null, [-12, -10], "standard", {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode,
        vectorscopePolarLevelMaxHold: false,
      });
      expect(screen.getByTestId("dock-vectorscope-pair-labels")).toBeTruthy();
      rect.mockRestore();
    }
  );

  it("reserves a Dock label row below the polar drawing", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 72,
      top: 0,
      right: 220,
      bottom: 72,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith(null, [-12, -10], "standard", {
      vectorscopePair: { x: 0, y: 1 },
      vectorscopeMode: "polarSample",
      vectorscopePolarLevelMaxHold: false,
    });

    expect(screen.getByTestId("dock-vectorscope-polar-stage").className).toContain(
      "bottom-[calc(var(--ui-dock-fs-label)_+_2px)]"
    );
    rect.mockRestore();
  });

  it("insets the Lissajous grid away from the corner labels", () => {
    renderWith(null);
    const lines = screen.getByTestId("dock-vectorscope-lissajous-grid").querySelectorAll("line");

    expect(lines[0].getAttribute("x1")).toBe("4");
    expect(lines[0].getAttribute("y1")).toBe("4");
    expect(lines[1].getAttribute("x1")).toBe("256");
    expect(lines[1].getAttribute("y1")).toBe("4");
  });

  it("offers click-to-reset without a plot hover tooltip", () => {
    const polarControls = {
      vectorscopePair: { x: 0, y: 1 },
      vectorscopeMode: "polarLevel",
      vectorscopePolarLevelMaxHold: true,
    };
    renderWith(null, [-12, -10], "standard", polarControls);
    const plot = screen.getByTestId("dock-vectorscope-plot");
    expect(plot.getAttribute("data-max-hold-reset")).toBe("true");
    expect(plot.className).toContain("cursor-pointer");
    fireEvent.mouseEnter(plot);
    expect(screen.queryByText("Click to reset Max hold")).toBeNull();
    fireEvent.click(plot);
  });

  it("gives a Polar mode a 2:1 plot that fills the dock height", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 80,
      top: 0,
      right: 300,
      bottom: 80,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith(null, [-12, -10], "standard", {
      vectorscopePair: { x: 0, y: 1 },
      vectorscopeMode: "polarLevel",
      vectorscopePolarLevelMaxHold: false,
    });
    // availHeight 80, availWidth 300 - 8 - 72 = 220 → height fills to 80, width = 2 * 80 = 160.
    const plot = screen.getByTestId("dock-vectorscope-plot");
    expect(plot.style.height).toBe("80px");
    expect(plot.style.width).toBe("160px");
    rect.mockRestore();
  });

  it("keeps Lissajous square in the dock", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 80,
      top: 0,
      right: 300,
      bottom: 80,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    renderWith(null, [-12, -10], "standard", {
      vectorscopePair: { x: 0, y: 1 },
      vectorscopeMode: "lissajous",
      vectorscopePolarLevelMaxHold: false,
    });
    // side = min(80, 220) = 80: unchanged square.
    const plot = screen.getByTestId("dock-vectorscope-plot");
    expect(plot.style.height).toBe("80px");
    expect(plot.style.width).toBe("80px");
    rect.mockRestore();
  });

  it("hides the Dock reset affordance for Lissajous and Max hold off", () => {
    for (const polarControls of [
      {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode: "lissajous",
        vectorscopePolarLevelMaxHold: true,
      },
      {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: false,
      },
    ]) {
      const { unmount } = renderWith(null, [-12, -10], "standard", polarControls);
      expect(screen.getByTestId("dock-vectorscope-plot").hasAttribute("data-max-hold-reset")).toBe(
        false
      );
      unmount();
    }
  });
});
