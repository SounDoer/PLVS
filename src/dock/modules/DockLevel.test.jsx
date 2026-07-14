import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockLevel } from "./DockLevel.jsx";

function renderWith(frameData, controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level) {
  return render(
    <FrameDataProvider value={frameData}>
      <DockLevel controls={controls} />
    </FrameDataProvider>
  );
}

describe("DockLevel", () => {
  it("renders live Peak bars, channel labels, and the current maximum", () => {
    renderWith({ displayAudio: { peakDb: [-12, -9.5] } });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByText("-9.5")).toBeTruthy();
    expect(screen.getByText("PK")).toBeTruthy();
  });

  it("shows and resets the true-peak maximum", () => {
    const onResetTpMax = vi.fn();
    renderWith(
      {
        displayAudio: { peakDb: [-12, -9.5], tpMax: -3.2 },
        hasTpMaxValue: true,
        onResetTpMax,
      },
      { mode: "peak", readout: "truePeakMax", showLabels: true }
    );
    expect(screen.getByText("-3.2")).toBeTruthy();
    expect(screen.getByText("TP")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset true peak maximum" }));
    expect(onResetTpMax).toHaveBeenCalledOnce();
  });

  it("renders RMS from the per-channel RMS values", () => {
    renderWith(
      { displayAudio: { peakDb: [-6, -5], rmsDb: [-22.4, -18.1] } },
      { mode: "rms", readout: "live", showLabels: false }
    );
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getByText("-18.1")).toBeTruthy();
    expect(screen.getByText("RMS")).toBeTruthy();
    expect(screen.queryByText("L")).toBeNull();
  });

  it.each([
    ["momentary", "momentary", -20.3, "M"],
    ["shortTerm", "shortTerm", -18.7, "ST"],
  ])("renders the %s scalar meter", (mode, field, value, label) => {
    renderWith(
      { displayAudio: { peakDb: [-8, -7], [field]: value } },
      { mode, readout: "live", showLabels: true }
    );
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(1);
    expect(screen.getByText(String(value))).toBeTruthy();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("shows an idle stereo fallback with no signal", () => {
    renderWith({ displayAudio: { peakDb: [] } });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getByText("-")).toBeTruthy();
  });
});
