/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";
import { profileSelectionId } from "../../lib/loudnessProfileCatalog.js";
import { thresholdZones, zonesToGradient } from "../../lib/levelMeterColors.js";
import { settingsStore } from "../../persistence/index.js";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockLevel } from "./DockLevel.jsx";

function renderWith(
  frameData,
  controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
  heightMode = "standard"
) {
  return render(
    <LoudnessProfileProvider>
      <FrameDataProvider value={frameData}>
        <DockLevel controls={controls} heightMode={heightMode} />
      </FrameDataProvider>
    </LoudnessProfileProvider>
  );
}

afterEach(() => settingsStore.reset());

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
      { levelMeterMode: "peak", readout: "truePeakMax", showLabels: true },
      "compact"
    );
    expect(screen.getByText("-3.2").className).toContain("var(--ui-dock-fs-value)");
    expect(screen.getByTestId("dock-expanded-metric").textContent).toBe("TP Max-3.2");
    expect(screen.queryByTestId("dock-expanded-metric-unit")).toBeNull();
    expect(screen.queryByTestId("dock-level-readout-source")).toBeNull();
    expect(screen.queryByTestId("dock-level-channel-readout")).toBeNull();
    expect(screen.getByTestId("dock-level-readout-sizer").getAttribute("aria-hidden")).toBe("true");
    const readoutContent = screen.getByTestId("dock-level-readout-content");
    expect(readoutContent.contains(screen.getByTestId("dock-expanded-metric"))).toBe(true);
    expect(readoutContent.className).toContain("self-center");
    expect(readoutContent.className).toContain("items-baseline");
    expect(screen.getByText("-3.2").parentElement.className).not.toContain(
      "w-[var(--ui-dock-readout-w)]"
    );
    expect(screen.getByTestId("dock-expanded-metric").className).toContain("items-start");
    expect(
      screen.getAllByTestId("dock-level-bar").every((bar) => bar.className.includes("h-full"))
    ).toBe(true);
    const reset = screen.getByRole("button", { name: "Reset true peak maximum" });
    expect(reset.title).toBe("");
    fireEvent.mouseEnter(reset);
    expect(screen.getByRole("tooltip").textContent).toBe("Reset TP Max");
    fireEvent.click(reset);
    expect(onResetTpMax).toHaveBeenCalledOnce();
  });

  it("shows a two-line true-peak readout with its unit in Expanded mode", () => {
    renderWith(
      {
        displayAudio: { peakDb: [-12, -9.5], tpMax: -3.2 },
        hasTpMaxValue: true,
      },
      { levelMeterMode: "peak", readout: "truePeakMax", showLabels: true },
      "expanded"
    );

    const metric = screen.getByTestId("dock-expanded-metric");
    expect(metric.textContent).toBe("TP Max-3.2dBTP");
    expect(metric.className).toContain("items-start");
    expect(metric.parentElement.className).toContain("w-full");
    expect(screen.getByTestId("dock-expanded-metric-unit").className).toContain(
      "@max-[68px]:hidden"
    );
    expect(screen.getByTestId("dock-level-readout-region").style.width).toBe(
      "clamp(48px, 28%, 76px)"
    );
    expect(screen.queryByTestId("dock-level-readout-source")).toBeNull();
  });

  it("renders RMS from the per-channel RMS values", () => {
    renderWith(
      { displayAudio: { peakDb: [-6, -5], rmsDb: [-22.4, -18.1] } },
      { levelMeterMode: "rms", readout: "live", showLabels: false }
    );
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(
      screen.getAllByTestId("dock-level-channel-readout").map((node) => node.textContent)
    ).toEqual(["-22.4", "-18.1"]);
    expect(screen.queryByText("RMS")).toBeNull();
    expect(screen.queryByText("L")).toBeNull();
  });

  it("keeps RMS playback maxima per channel while bars stay live", async () => {
    const controls = { levelMeterMode: "rms", readout: "playbackMax", showLabels: true };
    const { rerender } = renderWith(
      { displayAudio: { peakDb: [-6, -5], rmsDb: [-12, -18] } },
      controls
    );

    rerender(
      <LoudnessProfileProvider>
        <FrameDataProvider value={{ displayAudio: { peakDb: [-7, -6], rmsDb: [-20, -10] } }}>
          <DockLevel controls={controls} />
        </FrameDataProvider>
      </LoudnessProfileProvider>
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("dock-level-channel-readout").map((node) => node.textContent)
      ).toEqual(["-12.0", "-10.0"]);
    });
    const source = screen.getByTestId("dock-level-readout-source");
    expect(source.textContent).toBe("PB Max");
    expect(source.title).toBe("");
    fireEvent.mouseEnter(source);
    expect(screen.getByRole("tooltip").textContent).toBe("Playback Max");
    expect(
      screen.getAllByTestId("dock-level-channel-readout")[0].parentElement.className
    ).toContain("w-max");
    expect(
      screen
        .getAllByTestId("dock-level-channel-readout")
        .every((node) => node.className.includes("text-right"))
    ).toBe(true);
  });

  it.each([
    ["momentary", "momentary", -20.3, "M"],
    ["shortTerm", "shortTerm", -18.7, "ST"],
  ])("renders the %s scalar meter", (levelMeterMode, field, value, label) => {
    renderWith(
      { displayAudio: { peakDb: [-8, -7], [field]: value } },
      { levelMeterMode, readout: "live", showLabels: true }
    );
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(1);
    expect(screen.getByText(String(value))).toBeTruthy();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("separates the scalar mode from its playback-max source", async () => {
    renderWith(
      { displayAudio: { peakDb: [-8, -7], momentary: -20.3 } },
      { levelMeterMode: "momentary", readout: "playbackMax", showLabels: true }
    );

    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByTestId("dock-expanded-metric").textContent).toBe("PB Max-20.3");
    expect(screen.queryByTestId("dock-expanded-metric-unit")).toBeNull();
    expect(screen.queryByTestId("dock-level-readout-source")).toBeNull();
    expect(screen.queryByText("M Max")).toBeNull();
    await waitFor(() => expect(screen.getByText("-20.3")).toBeTruthy());
  });

  it("shows an idle stereo fallback with no signal", () => {
    renderWith({ displayAudio: { peakDb: [] } });
    expect(screen.getAllByTestId("dock-level-bar")).toHaveLength(2);
    expect(screen.getAllByText("-")).toHaveLength(2);
  });

  it("sizes the fill gradient to the whole track rather than stretching it over the fill", () => {
    renderWith({ displayAudio: { peakDb: [-12, -30] } });
    for (const bar of screen.getAllByTestId("dock-level-bar")) {
      const fill = bar.firstChild;
      const widthPct = parseFloat(fill.style.width);
      const gradientPct = parseFloat(fill.style.backgroundSize);
      expect((widthPct * gradientPct) / 100).toBeCloseTo(100, 6);
    }
  });

  it("anchors the Peak colours to the Dock's own thresholds over the whole track", () => {
    renderWith(
      { displayAudio: { peakDb: [-12, -30] } },
      {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
        levelMeterBarColors: "levelZones",
        levelMeterPeakWarningDb: -10,
        levelMeterPeakCriticalDb: -2,
      }
    );
    const fill = screen.getAllByTestId("dock-level-bar")[0].firstChild;
    expect(fill.dataset.levelMeterGradient).toBe(
      zonesToGradient(thresholdZones(-10, -2), -60, 3, "to right")
    );
  });

  it("no longer floods the whole bar critical at clip", () => {
    renderWith({ displayAudio: { peakDb: [0, 0] } });
    const fill = screen.getAllByTestId("dock-level-bar")[0].firstChild;
    expect(fill.dataset.levelMeterGradient).toBe(
      "linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, var(--ui-level-critical) 100%)"
    );
    expect(fill.style.backgroundColor).toBe("");
  });

  it("shows the Short-term trace colour when no Profile judges Short-term", () => {
    renderWith(
      { displayAudio: { shortTerm: -20 } },
      {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
        levelMeterMode: "shortTerm",
        levelMeterBarColors: "levelZones",
      }
    );
    expect(screen.getByTestId("dock-level-bar").firstChild.dataset.levelMeterGradient).toBe(
      "linear-gradient(to right, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
    );
  });

  it("follows a Short-term Max ceiling from the active Profile", () => {
    const profile = {
      id: "dock-profile",
      name: "Dock profile",
      referenceLufs: null,
      rules: [{ metricId: "shortTermMax", op: ">", value: -18, severity: "fail" }],
    };
    settingsStore.patch({
      loudnessProfiles: { active: profileSelectionId(profile.id), profiles: [profile] },
    });
    renderWith(
      { displayAudio: { shortTerm: -20 } },
      {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
        levelMeterMode: "shortTerm",
        levelMeterBarColors: "levelZones",
      }
    );
    expect(screen.getByTestId("dock-level-bar").firstChild.dataset.levelMeterGradient).toBe(
      "linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-safe) 71.875%, var(--ui-level-critical) 71.875%, var(--ui-level-critical) 100%)"
    );
  });
});
