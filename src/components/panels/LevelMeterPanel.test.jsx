/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FrameDataProvider, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { LevelMeterPanel } from "./LevelMeterPanel.jsx";
import { settingsStore } from "../../persistence/index.js";
import { builtinSelectionId } from "../../lib/loudnessProfileCatalog.js";

function selectProfile(selection) {
  settingsStore.patch({ loudnessProfiles: { active: selection } });
}

function panel(value = {}) {
  const { panelControls = { levelMeterMode: "peak" }, onPanelControlsChange, ...shared } = value;
  return (
    <FrameDataProvider
      value={{
        displayAudio: {
          peakDb: [-9.9, -10],
          rmsDb: [-18.2, -19.4],
          momentary: -22.4,
          shortTerm: -18.6,
          tpMax: -1,
        },
        peakLabelContext: { resolvedLayout: "stereo" },
        hasTpMaxValue: true,
        ...shared,
      }}
    >
      <PanelInstanceProvider value={{ panelControls, onPanelControlsChange }}>
        <LevelMeterPanel />
      </PanelInstanceProvider>
    </FrameDataProvider>
  );
}

function renderPanel(value = {}) {
  return render(panel(value));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  settingsStore.reset();
});

describe("LevelMeterPanel", () => {
  it("renders peak values in fixed-width nowrap slots separate from channel labels", () => {
    renderPanel();

    const leftValue = screen.getByText("-9.9");
    const leftLabel = screen.getByText("L");

    expect(leftValue.className).toContain("w-[5ch]");
    expect(leftValue.className).toContain("whitespace-nowrap");
    expect(leftValue.closest("[data-peak-value]")?.className).toContain("@max-[48px]:hidden");
    expect(leftValue.closest("[data-peak-value]")?.className).not.toContain("@max-[220px]:hidden");
    expect(leftLabel.closest("[data-peak-channel-label]")?.className).toContain(
      "@max-[24px]:hidden"
    );
    expect(leftLabel.closest("[data-peak-channel-label]")?.className).not.toContain(
      "@max-[220px]:hidden"
    );
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
    expect(channelGrid?.querySelector("div")?.className).toContain("@container");
    expect(channelGrid?.getAttribute("style")).toContain("--ui-level-meter-channel-gap: 0.15rem");
    expect(channelGrid?.getAttribute("style")).not.toContain("calc(");
    expect(barFill?.className).toContain("inset-x-[var(--ui-level-meter-bar-inset-x)]");
    expect(barFill?.getAttribute("style")).toContain("--ui-level-meter-bar-inset-x: 0.1rem");
    expect(barFill?.getAttribute("style")).not.toContain("--ui-peak-channel-spacing-scale");
    expect(barFill?.className).not.toContain("--ui-meter-chart-inset-x");
  });

  it("does not reserve a bottom metric footer", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");
    const footer = container.querySelector("[data-level-meter-footer]");

    expect(layoutGrid.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(layoutGrid.className).toContain("gap-[var(--ui-chart-axis-gap)]");
    expect(footer).toBeNull();
  });

  it("lets the meter grid fill full height without a metric line", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");
    const footer = container.querySelector("[data-level-meter-footer]");

    // The grid is a single 1fr row, so y-axis + bars fill the panel without
    // reserving a footer row.
    expect(layoutGrid?.className).toContain("grid-rows-[minmax(0,1fr)]");
    expect(layoutGrid?.className).not.toContain("var(--ui-chart-x-axis-row-h)");
    expect(footer).toBeNull();
  });

  it("renders Momentary LUFS in Level Meter mode", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: true },
    });

    expect(screen.getAllByText("-22.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("LUFS")).toBeNull();
    expect(screen.queryByText("TP Max")).toBeNull();
    const marker = container.querySelector("[data-level-value-marker]");
    expect(marker?.textContent).toBe("-22.4");
    expect(container.querySelector("[data-level-value]")?.className).toContain("hidden");
    expect(container.querySelector("[data-level-meter-bar-region] > div")?.className).toContain(
      "@container"
    );
    expect(container.querySelector("[data-level-mode-label]")?.className).toContain(
      "@max-[24px]:hidden"
    );
    expect(marker.className).toContain("text-primary");
    expect(marker.className).toContain("font-[family-name:var(--ui-font-mono)]");
    expect(marker.className).toContain("text-[length:var(--ui-fs-display)]");
    expect(marker.className).toContain("tabular-nums");
    expect(marker.className).toContain("font-semibold");
    expect(marker.className).not.toContain("bg-primary");
    expect(marker.className).toContain("left-0");
    expect(marker.className).toContain("text-left");
    expect(marker.className).not.toContain("right-0");
    expect(marker.className).not.toContain("translate-x");
    expect(marker.closest("[data-level-meter-y-axis]")?.className).toContain("w-[5ch]");
    expect(marker.closest("[data-level-meter-y-axis]")?.className).not.toContain(
      "w-[var(--ui-chart-y-axis-rail-w)]"
    );
    const axisTick = screen.getByText("-20");
    expect(axisTick.className).toContain("right-0");
    expect(axisTick.className).not.toContain("left-0");
    expect(axisTick.className).not.toContain("font-[family-name:var(--ui-font-mono)]");
    expect(axisTick.className).not.toContain("tabular-nums");
  });

  it("renders Short-term LUFS in Level Meter mode", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "shortTerm", levelMeterValueMarker: true },
    });

    expect(screen.getAllByText("-18.6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ST").length).toBeGreaterThan(0);
    expect(screen.queryByText("Short-term")).toBeNull();
    expect(screen.queryByText("LUFS")).toBeNull();
    expect(container.querySelector("[data-level-value-marker]")?.textContent).toBe("-18.6");
  });

  it("renders RMS as per-channel bars with channel labels and the Peak-family y-axis", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "rms" },
    });

    expect(screen.getByText("-18.2")).toBeTruthy();
    expect(screen.getByText("-19.4")).toBeTruthy();
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.queryByText("RMS")).toBeNull();
    expect(screen.getByText("+3").className).toContain("top-0");
    expect(screen.getByText("-60").className).toContain("bottom-0");
    expect(container.querySelector("[data-level-mode-label]")).toBeNull();
    expect(container.querySelector("[data-level-meter-channel-grid]")).toBeTruthy();
  });

  it("floors extremely low RMS readouts instead of showing numeric residue", () => {
    renderPanel({
      displayAudio: { peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -143.2] },
      panelControls: { levelMeterMode: "rms" },
    });

    expect(screen.queryByText("-143.2")).toBeNull();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("leaves the TP Max marker neutral when no profile sets a limit", () => {
    // Off means nothing to judge against, so the marker reads like the M/ST markers on this
    // same meter rather than announcing a breach that no rule defines.
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    const marker = container.querySelector("[data-level-tp-max-marker]");
    expect(marker.className).toContain("text-primary");
    expect(marker.className).not.toContain("--ui-signal-tp-max");
  });

  it("colours the TP Max marker once the active profile's limit is exceeded", () => {
    // EBU R128 caps true peak at -1 dBTP and the fixture sits at -1.
    selectProfile(builtinSelectionId("ebu-r128"));
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]").className).toContain(
      "--ui-signal-tp-max"
    );
  });

  it("keeps the TP Max marker neutral while the level is inside the profile's limit", () => {
    selectProfile(builtinSelectionId("ebu-r128"));
    const { container } = renderPanel({
      displayAudio: {
        peakDb: [-9.9, -10],
        rmsDb: [-18.2, -19.4],
        momentary: -22.4,
        shortTerm: -18.6,
        tpMax: -12,
      },
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]").className).not.toContain(
      "--ui-signal-tp-max"
    );
  });

  it("does not carry the Peak TP Max marker into RMS mode", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "rms", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain(
      "w-[var(--ui-chart-y-axis-rail-w)]"
    );
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).not.toContain(
      "w-[5ch]"
    );
  });

  it("keeps LUFS axis endpoint labels inside the chart bounds", () => {
    renderPanel({ panelControls: { levelMeterMode: "shortTerm" } });

    expect(screen.getByText("0").className).toContain("top-0");
    expect(screen.getByText("0").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-64").className).toContain("bottom-0");
    expect(screen.getByText("-64").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-20").className).toContain("-translate-y-1/2");
  });

  it("keeps peak axis endpoint labels inside the chart bounds", () => {
    renderPanel();

    expect(screen.getByText("+3").className).toContain("top-0");
    expect(screen.getByText("+3").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-60").className).toContain("bottom-0");
    expect(screen.getByText("-60").className).not.toContain("-translate-y-1/2");
    expect(screen.getByText("-20").className).toContain("-translate-y-1/2");
  });

  it("renders the TP Max marker in Peak mode without a unit", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
    const marker = container.querySelector("[data-level-tp-max-marker]");
    expect(marker?.textContent).toBe("-1.0");
    expect(screen.queryByText("dBTP")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain("w-[5ch]");
  });

  it("keeps the wider Peak y-axis reserved when TP Max marker is enabled without a value", () => {
    const { container } = renderPanel({
      hasTpMaxValue: false,
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain("w-[5ch]");
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).not.toContain(
      "w-[var(--ui-chart-y-axis-rail-w)]"
    );
  });

  it("hides the TP Max marker by default", () => {
    const { container } = renderPanel();

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain(
      "w-[var(--ui-chart-y-axis-rail-w)]"
    );
  });

  it("hides the value marker when the value is below the loudness scale minimum", () => {
    const { container } = renderPanel({
      displayAudio: { momentary: -819.1 },
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: true },
    });

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
  });

  it("formats out-of-range Momentary loudness like Stats instead of printing the raw sentinel", () => {
    const { container } = renderPanel({
      displayAudio: { peakDb: [-80, -80], momentary: -819.1 },
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: false },
    });

    expect(container.querySelector("[data-level-value]")?.textContent).toBe("-");
    expect(screen.queryByText("-819.1")).toBeNull();
  });

  it("hides the value marker when the panel setting is off", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: false },
    });

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
    expect(container.querySelector("[data-level-value]")?.className).toContain("flex");
    expect(container.querySelector("[data-level-meter-y-axis]")?.className).toContain(
      "w-[var(--ui-chart-y-axis-rail-w)]"
    );
  });

  it("uses playback max as the readout source without changing the live bar fill", async () => {
    const { container, rerender } = renderPanel({
      displayAudio: { peakDb: [-18, -18], momentary: -30 },
      panelControls: {
        levelMeterMode: "momentary",
        levelMeterPlaybackMax: true,
        levelMeterValueMarker: false,
      },
    });

    await waitFor(() =>
      expect(container.querySelector("[data-level-value]")?.textContent).toBe("-30.0")
    );
    expect(
      container.querySelector("[data-level-meter-bar-fill]")?.dataset.levelMeterFillValue
    ).toBe("-30.0");

    rerender(
      panel({
        displayAudio: { peakDb: [-18, -18], momentary: -34 },
        panelControls: {
          levelMeterMode: "momentary",
          levelMeterPlaybackMax: true,
          levelMeterValueMarker: false,
        },
      })
    );

    await waitFor(() =>
      expect(container.querySelector("[data-level-value]")?.textContent).toBe("-30.0")
    );
    expect(
      container.querySelector("[data-level-meter-bar-fill]")?.dataset.levelMeterFillValue
    ).toBe("-34.0");
  });

  it("uses playback max as the shared readout source for floating value", async () => {
    const { container } = renderPanel({
      displayAudio: { peakDb: [-18, -18], momentary: -30 },
      panelControls: {
        levelMeterMode: "momentary",
        levelMeterPlaybackMax: true,
        levelMeterValueMarker: true,
      },
    });

    await waitFor(() =>
      expect(container.querySelector("[data-level-value-marker]")?.textContent).toBe("-30.0")
    );
    expect(container.querySelector("[data-level-value]")?.className).toContain("hidden");
  });

  it("uses per-channel RMS playback max readouts while keeping live bar values", async () => {
    const controls = {
      levelMeterMode: "rms",
      levelMeterPlaybackMax: true,
    };
    const { container, rerender } = renderPanel({
      displayAudio: { peakDb: [-12, -12], rmsDb: [-20, -24] },
      panelControls: controls,
    });

    await waitFor(() => expect(screen.getByText("-20.0")).toBeTruthy());
    expect(screen.getByText("-24.0")).toBeTruthy();

    rerender(
      panel({
        displayAudio: { peakDb: [-12, -12], rmsDb: [-26, -18] },
        panelControls: controls,
      })
    );

    await waitFor(() => expect(screen.getByText("-20.0")).toBeTruthy());
    expect(screen.getByText("-18.0")).toBeTruthy();
    const fills = [...container.querySelectorAll("[data-level-meter-bar-fill]")];
    expect(fills).toHaveLength(2);
    expect(fills[0].dataset.levelMeterFillValue).toBe("-26.0");
    expect(fills[1].dataset.levelMeterFillValue).toBe("-18.0");
  });

  it("tracks RMS playback max from RMS values even when peak signal is below the playback gate", async () => {
    const controls = {
      levelMeterMode: "rms",
      levelMeterPlaybackMax: true,
    };
    const { container, rerender } = renderPanel({
      displayAudio: { peakDb: [-120, -120], rmsDb: [-20, -24] },
      panelControls: controls,
    });

    await waitFor(() => expect(screen.getByText("-20.0")).toBeTruthy());

    rerender(
      panel({
        displayAudio: { peakDb: [-120, -120], rmsDb: [-26, -18] },
        panelControls: controls,
      })
    );

    await waitFor(() => expect(screen.getByText("-20.0")).toBeTruthy());
    expect(screen.getByText("-18.0")).toBeTruthy();
    const fills = [...container.querySelectorAll("[data-level-meter-bar-fill]")];
    expect(fills[0].dataset.levelMeterFillValue).toBe("-26.0");
    expect(fills[1].dataset.levelMeterFillValue).toBe("-18.0");
  });

  it("replaces RMS playback max when a new lower playback starts", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const controls = {
      levelMeterMode: "rms",
      levelMeterPlaybackMax: true,
    };
    const { container, rerender } = renderPanel({
      displayAudio: { peakDb: [-12, -12], rmsDb: [-18, -20] },
      panelControls: controls,
    });

    await waitFor(() => expect(screen.getByText("-18.0")).toBeTruthy());

    nowSpy.mockReturnValue(100);
    rerender(
      panel({
        displayAudio: { peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -Infinity] },
        panelControls: controls,
      })
    );
    nowSpy.mockReturnValue(500);
    rerender(
      panel({
        displayAudio: { peakDb: [-24, -24], rmsDb: [-32, -36] },
        panelControls: controls,
      })
    );

    await waitFor(() => expect(screen.getByText("-32.0")).toBeTruthy());
    expect(screen.getByText("-36.0")).toBeTruthy();
    const fills = [...container.querySelectorAll("[data-level-meter-bar-fill]")];
    expect(fills[0].dataset.levelMeterFillValue).toBe("-32.0");
    expect(fills[1].dataset.levelMeterFillValue).toBe("-36.0");
  });

  it("replaces playback max when a new lower playback starts", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    const controls = {
      levelMeterMode: "momentary",
      levelMeterPlaybackMax: true,
      levelMeterValueMarker: false,
    };
    const { container, rerender } = renderPanel({
      displayAudio: { peakDb: [-18, -18], momentary: -20 },
      panelControls: controls,
    });

    await waitFor(() =>
      expect(container.querySelector("[data-level-value]")?.textContent).toBe("-20.0")
    );

    nowSpy.mockReturnValue(100);
    rerender(
      panel({
        displayAudio: { peakDb: [-Infinity, -Infinity], momentary: -Infinity },
        panelControls: controls,
      })
    );
    nowSpy.mockReturnValue(500);
    rerender(
      panel({
        displayAudio: { peakDb: [-30, -30], momentary: -35 },
        panelControls: controls,
      })
    );

    await waitFor(() =>
      expect(container.querySelector("[data-level-value]")?.textContent).toBe("-35.0")
    );
  });
});
