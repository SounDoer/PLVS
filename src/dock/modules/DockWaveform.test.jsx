import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockWaveform } from "./DockWaveform.jsx";

function rows(values) {
  // Each row: symmetric min/max envelope across one stereo channel pair.
  return values.map((v) => ({
    waveformMin: [-v, -v * 0.8],
    waveformMax: [v, v * 0.8],
  }));
}

function renderWith(histSourceList) {
  return render(
    <HistoryDataProvider value={{ histSourceList }}>
      <DockWaveform />
    </HistoryDataProvider>
  );
}

describe("DockWaveform", () => {
  it("renders an envelope path whose shape follows the history", () => {
    const quiet = renderWith(rows(Array(50).fill(0.05)));
    const quietD = quiet.container.querySelector("svg path").getAttribute("d");
    quiet.unmount();
    const loud = renderWith(rows(Array.from({ length: 50 }, (_, i) => 0.05 + i * 0.015)));
    const loudD = loud.container.querySelector("svg path").getAttribute("d");
    expect(quietD).not.toBe(loudD);
    // varying envelope must produce >1 distinct Y value
    const ys = loudD
      .split(/[MLZ]/)
      .map((seg) => seg.trim().split(/\s+/)[1])
      .filter(Boolean);
    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it("renders an empty svg without history", () => {
    const { container } = renderWith([]);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg path")).toBeNull();
  });
});
