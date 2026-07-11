import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockCorrelation } from "./DockCorrelation.jsx";

function renderWith(correlation, displayAudio = { peakDb: [-12, -10] }) {
  return render(
    <FrameDataProvider value={{ correlation, displayAudio }}>
      <DockCorrelation />
    </FrameDataProvider>
  );
}

describe("DockCorrelation", () => {
  it("shows the correlation value and positions the marker", () => {
    renderWith(0.5);
    expect(screen.getByText("+0.50")).toBeTruthy();
    // marker at (0.5 + 1) / 2 = 75%
    expect(screen.getByTestId("dock-correlation-marker").style.left).toBe("75%");
  });

  it("clamps and formats negative correlation", () => {
    renderWith(-1);
    expect(screen.getByText("-1.00")).toBeTruthy();
    expect(screen.getByTestId("dock-correlation-marker").style.left).toBe("0%");
  });

  it("renders a dash without signal", () => {
    renderWith(-Infinity);
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("renders a dash and no marker during silence despite finite correlation", () => {
    // Rust DSP emits correlation = 0.0 during silence; gate on peakDb like
    // Stats / VectorscopePanel instead of showing a fake "+0.00".
    renderWith(0, { peakDb: [-Infinity, -Infinity] });
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByTestId("dock-correlation-marker")).toBeNull();
  });
});
