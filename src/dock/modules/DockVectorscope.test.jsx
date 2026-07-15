import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { dockVectorscopeKey } from "../dockAnalysisRequest.js";
import { DockVectorscope } from "./DockVectorscope.jsx";

const controls = { pair: { x: 0, y: 1 } };
const key = dockVectorscopeKey(controls);

function renderWith(result, peakDb = [-12, -10], heightMode = "standard") {
  return render(
    <FrameDataProvider
      value={{
        channelCount: 2,
        displayAudio: {
          peakDb,
          vectorscopeResultsByKey: result ? { [key]: result } : {},
        },
      }}
    >
      <DockVectorscope controls={controls} heightMode={heightMode} />
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
    expect(screen.getByText("L").className).toContain("var(--ui-dock-fs-label)");
    expect(screen.getByText("-1").parentElement?.className).toContain("var(--ui-dock-fs-caption)");
    expect(screen.getByText("+0.50").className).toContain("var(--ui-dock-fs-value)");
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
    expect(rail.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rect.mockRestore();
  });

  it("hides the marker during silence despite finite correlation", () => {
    renderWith({ path: "M 20 20", correlation: 0, pairX: 0, pairY: 1 }, [-Infinity, -Infinity]);
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByTestId("dock-vectorscope-correlation-marker")).toBeNull();
  });
});
