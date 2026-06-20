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
});
