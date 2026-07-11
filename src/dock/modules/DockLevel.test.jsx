import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockLevel } from "./DockLevel.jsx";

function renderWith(frameData) {
  return render(
    <FrameDataProvider value={frameData}>
      <DockLevel />
    </FrameDataProvider>
  );
}

describe("DockLevel", () => {
  it("renders one bar per channel and the true-peak readout", () => {
    renderWith({
      displayAudio: { peakDb: [-12, -9.5], tpMax: -3.2 },
      hasTpMaxValue: true,
    });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getByText("-3.2")).toBeTruthy();
  });

  it("shows a placeholder readout with no signal", () => {
    renderWith({ displayAudio: { peakDb: [] }, hasTpMaxValue: false });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2); // idle stereo placeholder
    expect(screen.getByText("-")).toBeTruthy();
  });
});
