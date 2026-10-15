/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";
import { DockLevel } from "./DockLevel.jsx";
function mount(controls, onResetTpMax = vi.fn()) {
  return render(
    <LoudnessProfileProvider>
      <FrameDataProvider
        value={{
          displayAudio: { peakDb: [-12, -9.5], tpMax: -3.2 },
          hasTpMaxValue: true,
          onResetTpMax,
          peakLabelContext: { resolvedLayout: "stereo" },
        }}
      >
        <DockLevel controls={controls} />
      </FrameDataProvider>
    </LoudnessProfileProvider>
  );
}
describe("DockLevel shared renderer", () => {
  it.each(["bottom-to-top", "left-to-right", "top-to-bottom", "right-to-left"])(
    "supports %s orientation and keeps channel readouts",
    (orientation) => {
      const { container } = mount({
        levelMeterOrientation: orientation,
        levelMeterTpMaxMarker: false,
      });
      expect(screen.queryByText("L")).toBeTruthy();
      expect(screen.queryByText("R")).toBeTruthy();
      expect(screen.getByText("-12.0")).toBeTruthy();
      expect(container.querySelectorAll("[data-level-meter-gradient]")).toHaveLength(2);
    }
  );
  it("migrates legacy TP Max readout to the shared resettable marker", () => {
    const reset = vi.fn();
    const { container } = mount(
      { readout: "truePeakMax", levelMeterOrientation: "left-to-right" },
      reset
    );
    fireEvent.click(container.querySelector("[data-level-tp-max-marker]"));
    expect(reset).toHaveBeenCalledOnce();
  });
});
