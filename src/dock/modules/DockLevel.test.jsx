import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("renders live Peak bars, channel labels, and per-channel values", () => {
    renderWith({ displayAudio: { peakDb: [-12, -9.5] } });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(
      screen.getAllByTestId("dock-level-channel-readout").map((node) => node.textContent)
    ).toEqual(["-12.0", "-9.5"]);
    expect(screen.getByText("PK")).toBeTruthy();
    expect(screen.queryByTestId("dock-level-readout-source")).toBeNull();
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
    expect(screen.getByTestId("dock-level-readout-source").textContent).toBe("TP Max");
    expect(screen.queryByTestId("dock-level-channel-readout")).toBeNull();
    const source = screen.getByTestId("dock-level-readout-source");
    expect(screen.getByTestId("dock-level-readout-region").contains(source)).toBe(true);
    expect(screen.getByTestId("dock-level-meter-region").contains(source)).toBe(false);
    expect(screen.getByTestId("dock-level-readout-sizer").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("dock-level-readout-content").contains(source)).toBe(true);
    expect(
      screen.getAllByTestId("dock-level-bar").every((bar) => bar.className.includes("h-full"))
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset true peak maximum" }));
    expect(onResetTpMax).toHaveBeenCalledOnce();
  });

  it("renders RMS from the per-channel RMS values", () => {
    renderWith(
      { displayAudio: { peakDb: [-6, -5], rmsDb: [-22.4, -18.1] } },
      { mode: "rms", readout: "live", showLabels: false }
    );
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(
      screen.getAllByTestId("dock-level-channel-readout").map((node) => node.textContent)
    ).toEqual(["-22.4", "-18.1"]);
    expect(screen.queryByText("RMS")).toBeNull();
    expect(screen.queryByText("L")).toBeNull();
  });

  it("keeps RMS playback maxima per channel while bars stay live", async () => {
    const controls = { mode: "rms", readout: "playbackMax", showLabels: true };
    const { rerender } = renderWith(
      { displayAudio: { peakDb: [-6, -5], rmsDb: [-12, -18] } },
      controls
    );

    rerender(
      <FrameDataProvider value={{ displayAudio: { peakDb: [-7, -6], rmsDb: [-20, -10] } }}>
        <DockLevel controls={controls} />
      </FrameDataProvider>
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("dock-level-channel-readout").map((node) => node.textContent)
      ).toEqual(["-12.0", "-10.0"]);
    });
    expect(screen.getByTestId("dock-level-readout-source").textContent).toBe("PB Max");
    expect(screen.getByTitle("Playback Max")).toBeTruthy();
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

  it("separates the scalar mode from its playback-max source", async () => {
    renderWith(
      { displayAudio: { peakDb: [-8, -7], momentary: -20.3 } },
      { mode: "momentary", readout: "playbackMax", showLabels: true }
    );

    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByTestId("dock-level-readout-source").textContent).toBe("PB Max");
    expect(screen.queryByText("M Max")).toBeNull();
    await waitFor(() => expect(screen.getByText("-20.3")).toBeTruthy());
  });

  it("shows an idle stereo fallback with no signal", () => {
    renderWith({ displayAudio: { peakDb: [] } });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getAllByText("-")).toHaveLength(2);
  });
});
