import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MetricsDataProvider } from "../../workspace/AudioDataContext.jsx";
import { workspaceStore } from "../../persistence/index.js";
import { DockStats } from "./DockStats.jsx";

const METRICS = [
  { id: "integrated", shortLabel: "I", unit: "LUFS", value: "-20.1" },
  { id: "truePeak", shortLabel: "TP Max", unit: "dBTP", value: "-3.2" },
  { id: "lra", shortLabel: "LRA", unit: "LU", value: "7.4" },
  { id: "psr", shortLabel: "PSR", unit: "dB", value: "11.0" },
];

function renderWith(statsMetrics) {
  return render(
    <MetricsDataProvider value={{ statsMetrics }}>
      <DockStats />
    </MetricsDataProvider>
  );
}

describe("DockStats", () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it("renders the default selection in catalog order", () => {
    renderWith(METRICS);
    const cells = screen.getAllByTestId("dock-stat");
    expect(cells).toHaveLength(3); // integrated, truePeak, lra defaults
    expect(screen.getByText("-20.1")).toBeTruthy();
    expect(screen.getByText("TP Max")).toBeTruthy();
    expect(screen.getByText("7.4")).toBeTruthy();
    expect(screen.queryByText("11.0")).toBeNull(); // psr not selected
  });

  it("respects a persisted custom selection", () => {
    workspaceStore.patch({ dock: { modules: ["stats"], statsIds: ["psr"] } });
    renderWith(METRICS);
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(1);
    expect(screen.getByText("11.0")).toBeTruthy();
  });

  it("renders dashes for metrics missing from the feed", () => {
    workspaceStore.patch({ dock: { modules: ["stats"], statsIds: ["sideToMid"] } });
    renderWith(METRICS); // feed has no sideToMid entry
    expect(screen.getByText("-")).toBeTruthy();
  });
});
