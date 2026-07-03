/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { VectorscopePanel } from "./VectorscopePanel.jsx";

function renderPanel(audioData) {
  return render(
    <AudioDataContext.Provider value={audioData}>
      <VectorscopePanel />
    </AudioDataContext.Provider>
  );
}

describe("VectorscopePanel", () => {
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

  it("smooths the live marker position but leaves snapshot markers immediate", () => {
    const live = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
      displayAudio: {
        peakDb: [-12, -18],
        vectorscopeResultsByKey: {
          "vectorscope:pair:0:1": { path: "M 0 0 L 100 100", correlation: 0.5, pairX: 0, pairY: 1 },
        },
      },
    });
    expect(
      live.container.querySelector("[data-vectorscope-correlation-marker]")?.className
    ).toContain("transition-[left]");

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
    ).not.toContain("transition-[left]");
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

  it("keeps the M/S energy cross hidden by default", () => {
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: { vectorscopePair: { x: 0, y: 1 } },
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

  it("shows the M/S energy cross when enabled", () => {
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

    expect(container.querySelector("[data-vectorscope-energy-cross]")).toBeTruthy();
  });
});
