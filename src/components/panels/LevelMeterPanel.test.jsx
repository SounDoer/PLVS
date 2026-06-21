/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { LevelMeterPanel } from "./LevelMeterPanel.jsx";

function renderPanel(value = {}) {
  return render(
    <AudioDataContext.Provider
      value={{
        displayAudio: { peakDb: [-9.9, -10], momentary: -22.4, shortTerm: -18.6 },
        peakLabelContext: { resolvedLayout: "stereo" },
        fmt: (v) => (Number.isFinite(v) ? v.toFixed(1) : "-"),
        hasTpMaxValue: true,
        panelControls: { levelMeterMode: "peak" },
        tpMaxText: "-1.0 dBTP",
        ...value,
      }}
    >
      <LevelMeterPanel />
    </AudioDataContext.Provider>
  );
}

describe("LevelMeterPanel", () => {
  it("renders peak values in fixed-width nowrap slots separate from channel labels", () => {
    renderPanel();

    const leftValue = screen.getByText("-9.9");
    const leftLabel = screen.getByText("L");

    expect(leftValue.className).toContain("w-[5ch]");
    expect(leftValue.className).toContain("whitespace-nowrap");
    expect(leftValue.closest("[data-peak-value]")).toBeTruthy();
    expect(leftLabel.closest("[data-peak-channel-label]")).toBeTruthy();
    expect(leftValue.parentElement).not.toBe(leftLabel.parentElement);
  });

  it("allows the chart column to shrink inside narrow split panes", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector(".grid-cols-\\[auto_minmax\\(0\\2c 1fr\\)\\]");

    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(layoutGrid).toBeTruthy();
  });

  it("renders Momentary LUFS in Level Meter mode", () => {
    renderPanel({ panelControls: { levelMeterMode: "momentary" } });

    expect(screen.getAllByText("-22.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
    expect(screen.getByText("LUFS")).toBeTruthy();
    expect(screen.queryByText("TP Max")).toBeNull();
  });

  it("renders Short-term LUFS in Level Meter mode", () => {
    renderPanel({ panelControls: { levelMeterMode: "shortTerm" } });

    expect(screen.getAllByText("-18.6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ST").length).toBeGreaterThan(0);
    expect(screen.getByText("LUFS")).toBeTruthy();
  });
});
