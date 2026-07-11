import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockCorrelation } from "./DockCorrelation.jsx";

function renderWith(correlation) {
  return render(
    <FrameDataProvider value={{ correlation }}>
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
});
