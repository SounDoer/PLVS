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

    const layoutGrid = container.querySelector("[data-level-meter-grid]");

    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(layoutGrid).toBeTruthy();
    expect(layoutGrid.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(layoutGrid.className).not.toContain("--ui-peak-axis-chart-gap");
  });

  it("uses compact Level Meter bar spacing without changing the protected axis gap", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");
    const channelGrid = container.querySelector("[data-level-meter-channel-grid]");
    const barFill = container.querySelector("[data-level-meter-bar-fill]");

    expect(layoutGrid.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(layoutGrid.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(channelGrid?.className).toContain("gap-[var(--ui-level-meter-channel-gap)]");
    expect(channelGrid?.getAttribute("style")).toContain("--ui-level-meter-channel-gap: 0.15rem");
    expect(channelGrid?.getAttribute("style")).not.toContain("calc(");
    expect(barFill?.className).toContain("inset-x-[var(--ui-level-meter-bar-inset-x)]");
    expect(barFill?.getAttribute("style")).toContain("--ui-level-meter-bar-inset-x: 0.1rem");
    expect(barFill?.getAttribute("style")).not.toContain("--ui-peak-channel-spacing-scale");
    expect(barFill?.className).not.toContain("--ui-meter-chart-inset-x");
  });

  it("mirrors the neighbouring x-axis row with the bottom metric line when it is visible", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");
    const footer = container.querySelector("[data-level-meter-footer]");

    expect(layoutGrid.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(layoutGrid.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    // Footer matches an x-axis row: same height, same axis gap above it, axis font.
    expect(footer?.className).toContain("h-[var(--ui-chart-x-axis-row-h)]");
    expect(footer?.className).toContain("mt-[var(--ui-chart-axis-gap)]");
    expect(footer?.className).toContain("text-[length:var(--ui-fs-axis)]");
    expect(footer?.className).not.toContain("text-[length:var(--ui-fs-display)]");
  });

  it("lets the meter grid fill full height by collapsing the metric line when it is hidden", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");
    const footer = container.querySelector("[data-level-meter-footer]");

    // The grid is a single 1fr row, so y-axis + bars always fill it. With the
    // footer removed (display:none collapses its box and top margin), the grid
    // bottom lines up with the neighbours' x-axis bottom — no row-span hacks.
    expect(layoutGrid?.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(layoutGrid?.className).not.toContain("var(--ui-chart-x-axis-row-h)");
    expect(footer?.className).toContain("@max-[220px]:hidden");
    expect(footer?.parentElement).not.toBe(layoutGrid);
  });

  it("renders Momentary LUFS in Level Meter mode", () => {
    const { container } = renderPanel({ panelControls: { levelMeterMode: "momentary" } });

    expect(screen.getAllByText("-22.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
    expect(screen.getByText("LUFS")).toBeTruthy();
    expect(screen.queryByText("TP Max")).toBeNull();
    const marker = container.querySelector("[data-level-value-marker]");
    expect(marker?.textContent).toBe("-22.4");
    expect(marker.className).toContain("text-primary");
    expect(marker.className).toContain("font-[family-name:var(--ui-font-mono)]");
    expect(marker.className).toContain("tabular-nums");
    expect(marker.className).not.toContain("font-semibold");
    expect(marker.className).not.toContain("bg-primary");
    expect(marker.className).toContain("left-0");
    expect(marker.className).toContain("text-left");
    expect(marker.className).not.toContain("right-0");
    expect(marker.className).not.toContain("translate-x");
    expect(marker.closest("[data-level-meter-y-axis]")?.className).toContain("w-[5ch]");
    expect(marker.closest("[data-level-meter-y-axis]")?.className).not.toContain(
      "w-[var(--ui-w-axis-rail)]"
    );
    const axisTick = screen.getByText("-18");
    expect(axisTick.className).toContain("left-0");
    expect(axisTick.className).toContain("font-[family-name:var(--ui-font-mono)]");
    expect(axisTick.className).toContain("tabular-nums");
  });

  it("renders Short-term LUFS in Level Meter mode", () => {
    const { container } = renderPanel({ panelControls: { levelMeterMode: "shortTerm" } });

    expect(screen.getAllByText("-18.6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ST").length).toBeGreaterThan(0);
    expect(screen.getByText("LUFS")).toBeTruthy();
    expect(container.querySelector("[data-level-value-marker]")?.textContent).toBe("-18.6");
  });

  it("keeps LUFS axis endpoint labels inside the chart bounds", () => {
    renderPanel({ panelControls: { levelMeterMode: "shortTerm" } });

    expect(screen.getByText("0").className).toContain("top-0");
    expect(screen.getByText("0").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-63").className).toContain("bottom-0");
    expect(screen.getByText("-63").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-18").className).toContain("-translate-y-1/2");
  });

  it("keeps peak axis endpoint labels inside the chart bounds", () => {
    renderPanel();

    expect(screen.getByText("+3").className).toContain("top-0");
    expect(screen.getByText("+3").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-60").className).toContain("bottom-0");
    expect(screen.getByText("-60").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("0").className).toContain("-translate-y-1/2");
  });

  it("does not render the value marker in Peak mode", () => {
    const { container } = renderPanel();

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain(
      "w-[var(--ui-w-axis-rail)]"
    );
  });

  it("hides the value marker when the panel setting is off", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: false },
    });

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain(
      "w-[var(--ui-w-axis-rail)]"
    );
  });
});
