import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricsDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockStats } from "./DockStats.jsx";

const METRICS = [
  { id: "integrated", shortLabel: "I", unit: "LUFS", value: "-20.1" },
  { id: "truePeak", shortLabel: "TP Max", unit: "dBTP", value: "-3.2" },
  { id: "lra", shortLabel: "LRA", unit: "LU", value: "7.4" },
  { id: "psr", shortLabel: "PSR", unit: "dB", value: "11.0" },
];

function renderWith(statsMetrics, ids) {
  return render(
    <MetricsDataProvider value={{ statsMetrics }}>
      <DockStats controls={ids ? { ids } : undefined} />
    </MetricsDataProvider>
  );
}

describe("DockStats", () => {
  it("renders the default selection in catalog order", () => {
    renderWith(METRICS);
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(3);
    expect(screen.getByText("-20.1")).toBeTruthy();
    expect(screen.getByText("TP Max")).toBeTruthy();
    expect(screen.queryByText("11.0")).toBeNull();
  });

  it("respects the Dock-owned selection", () => {
    renderWith(METRICS, ["psr"]);
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(1);
    expect(screen.getByText("11.0")).toBeTruthy();
  });

  it("renders dashes for metrics missing from the feed", () => {
    renderWith(METRICS, ["sideToMid"]);
    expect(screen.getByText("-")).toBeTruthy();
  });
});
