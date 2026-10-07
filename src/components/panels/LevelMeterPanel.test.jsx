/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FrameDataProvider, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { LevelMeterPanel } from "./LevelMeterPanel.jsx";
import { settingsStore } from "../../persistence/index.js";
import { profileSelectionId } from "../../lib/loudnessProfileCatalog.js";
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";
import { profileZones, thresholdZones, zonesToGradient } from "../../lib/levelMeterColors.js";
import { LOUDNESS_PROFILE_OFF } from "../../lib/loudnessProfileCatalog.js";

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

function selectProfile(selection) {
  settingsStore.patch({
    loudnessProfiles: { active: selection, profiles: [TEST_PROFILE] },
  });
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
  return render(panel(value), { wrapper: LoudnessProfileProvider });
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

    expect(leftValue.parentElement).not.toBe(leftLabel.parentElement);
  });

  it("allows the chart column to shrink inside narrow split panes", () => {
    const { container } = renderPanel();

    const layoutGrid = container.querySelector("[data-level-meter-grid]");

    expect(layoutGrid).toBeTruthy();
  });

  it("uses compact Level Meter bar spacing without changing the protected axis gap", () => {
    const { container } = renderPanel();

    const channelGrid = container.querySelector("[data-level-meter-channel-grid]");
    const barFill = container.querySelector("[data-level-meter-bar-fill]");

    expect(channelGrid?.getAttribute("style")).toContain("--ui-level-meter-channel-gap: 0.15rem");
    expect(channelGrid?.getAttribute("style")).not.toContain("calc(");

    expect(barFill?.getAttribute("style")).toContain("--ui-level-meter-bar-inset-x: 0.1rem");
    expect(barFill?.getAttribute("style")).not.toContain("--ui-peak-channel-spacing-scale");
  });

  it("does not reserve a bottom metric footer", () => {
    const { container } = renderPanel();

    const footer = container.querySelector("[data-level-meter-footer]");

    expect(footer).toBeNull();
  });

  it("lets the meter grid fill full height without a metric line", () => {
    const { container } = renderPanel();

    const footer = container.querySelector("[data-level-meter-footer]");

    // The grid is a single 1fr row, so y-axis + bars fill the panel without
    // reserving a footer row.

    expect(footer).toBeNull();
  });

  it("renders Momentary LUFS in Level Meter mode", () => {
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] } });
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

  it("keeps the TP Max marker at foreground while inside the profile's limit", () => {
    selectProfile(profileSelectionId(TEST_PROFILE.id));
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

    expect(
      container.querySelector("[data-level-tp-max-marker]")?.getAttribute("data-loudness-status")
    ).toBe("ok");
  });

  it("reports the TP Max marker as off without an active profile", () => {
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] } });
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(
      container.querySelector("[data-level-tp-max-marker]")?.getAttribute("data-loudness-status")
    ).toBe("off");
  });

  it("reports a failed TP Max marker when the active profile limit is exceeded", () => {
    selectProfile(profileSelectionId(TEST_PROFILE.id));
    const { container } = renderPanel({
      displayAudio: { peakDb: [-1, -1], rmsDb: [-9, -9], tpMax: 0 },
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(
      container.querySelector("[data-level-tp-max-marker]")?.getAttribute("data-loudness-status")
    ).toBe("fail");
  });

  it("reports an unwatched Momentary marker as neutral under an active profile", () => {
    selectProfile(profileSelectionId(TEST_PROFILE.id));
    const { container } = renderPanel({
      displayAudio: { peakDb: [-9, -9], rmsDb: [-18, -18], momentary: -22.4, shortTerm: -18.6 },
      panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: true },
    });

    expect(
      container.querySelector("[data-level-value-marker]")?.getAttribute("data-loudness-status")
    ).toBe("neutral");
  });

  it("does not carry the Peak TP Max marker into RMS mode", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "rms", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
  });

  it("renders the TP Max marker in Peak mode without a unit", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-value-marker]")).toBeNull();
    const marker = container.querySelector("[data-level-tp-max-marker]");
    expect(marker?.textContent).toBe("-1.0");
    expect(screen.queryByText("dBTP")).toBeNull();
  });

  it("keeps the wider Peak y-axis reserved when TP Max marker is enabled without a value", () => {
    const { container } = renderPanel({
      hasTpMaxValue: false,
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
  });

  it("hides the TP Max marker by default", () => {
    const { container } = renderPanel();

    expect(container.querySelector("[data-level-tp-max-marker]")).toBeNull();
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
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-bar-fill]"))?.dataset
        .levelMeterFillValue
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
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-bar-fill]"))?.dataset
        .levelMeterFillValue
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
    expect(/** @type {HTMLElement} */ (fills[0]).dataset.levelMeterFillValue).toBe("-26.0");
    expect(/** @type {HTMLElement} */ (fills[1]).dataset.levelMeterFillValue).toBe("-18.0");
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
    expect(/** @type {HTMLElement} */ (fills[0]).dataset.levelMeterFillValue).toBe("-26.0");
    expect(/** @type {HTMLElement} */ (fills[1]).dataset.levelMeterFillValue).toBe("-18.0");
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
    expect(/** @type {HTMLElement} */ (fills[0]).dataset.levelMeterFillValue).toBe("-32.0");
    expect(/** @type {HTMLElement} */ (fills[1]).dataset.levelMeterFillValue).toBe("-36.0");
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

  it("pins the TP Max marker to the top of the axis when it reads above the range", () => {
    const { container } = renderPanel({
      panelControls: {
        levelMeterMode: "peak",
        levelMeterTpMaxMarker: true,
        levelMeterYMinDb: -60,
        levelMeterYMaxDb: -6,
      },
    });

    const marker = container.querySelector("[data-level-tp-max-marker]");
    expect(marker?.textContent).toBe("-1.0▲");
    const arrow = marker.querySelector("[data-marker-out-of-range]");
    expect(/** @type {HTMLElement} */ (arrow)?.dataset.markerOutOfRange).toBe("above");

    // Out of flow, or its margin alone would shift the right-aligned digits out of the column.

    expect(/** @type {HTMLElement} */ (marker).style.top).toBe("0%");
  });

  it("pins the TP Max marker to the bottom of the axis when it reads below the range", () => {
    const { container } = renderPanel({
      displayAudio: { peakDb: [-70, -70], tpMax: -70 },
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    const marker = container.querySelector("[data-level-tp-max-marker]");
    expect(marker?.textContent).toBe("-70.0▼");
    expect(
      /** @type {HTMLElement} */ (marker.querySelector("[data-marker-out-of-range]"))?.dataset
        .markerOutOfRange
    ).toBe("below");
    expect(/** @type {HTMLElement} */ (marker).style.top).toBe("100%");
  });

  it("keeps an in-range TP Max marker centred on its value and undimmed", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
    });

    const marker = container.querySelector("[data-level-tp-max-marker]");

    expect(marker.querySelector("[data-marker-out-of-range]")).toBeNull();
    // Shares the tick labels' anchor, so reading and ticks end on the same column.
  });

  it("keeps the TP Max reset clickable while the marker is pinned", () => {
    const onResetTpMax = vi.fn();
    const { container } = renderPanel({
      onResetTpMax,
      panelControls: {
        levelMeterMode: "peak",
        levelMeterTpMaxMarker: true,
        levelMeterYMinDb: -60,
        levelMeterYMaxDb: -6,
      },
    });

    fireEvent.click(container.querySelector("[data-level-tp-max-marker]"));

    expect(onResetTpMax).toHaveBeenCalledTimes(1);
  });

  it("pins the value marker to the top of the loudness axis when it reads above the range", () => {
    const { container } = renderPanel({
      displayAudio: { peakDb: [-9, -9], momentary: -2 },
      panelControls: {
        levelMeterMode: "momentary",
        levelMeterValueMarker: true,
        loudnessYMinDb: -64,
        loudnessYMaxDb: -20,
      },
    });

    const marker = container.querySelector("[data-level-value-marker]");
    expect(marker?.textContent).toBe("-2.0▲");
    expect(/** @type {HTMLElement} */ (marker).style.top).toBe("0%");
  });

  describe("ticks near a readout marker", () => {
    // jsdom does no layout: give the axis a 630px track (10px per dB over the default Peak range)
    // and the default interface size's label fonts, 12px ticks and a 14px marker.
    function stubAxisLayout() {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 40,
        height: 630,
        top: 0,
        right: 40,
        bottom: 630,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      const realGetComputedStyle = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
        if (!element?.hasAttribute?.("data-level-meter-y-axis-scale")) {
          return realGetComputedStyle(element, pseudo);
        }
        return {
          fontSize: "12px",
          getPropertyValue: (name) => (name === "--ui-fs-display" ? "14px" : ""),
        };
      });
    }

    function tickByLabel(container, label) {
      const scale = container.querySelector("[data-level-meter-y-axis-scale]");
      return [...scale.children].find(
        (child) => child.textContent === label && !child.hasAttribute("data-level-tp-max-marker")
      );
    }

    it("fades the tick under the TP Max marker by how far it clears the reading", async () => {
      stubAxisLayout();
      const { container } = renderPanel({
        displayAudio: { peakDb: [-9, -9], tpMax: -6.6 },
        panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
      });

      // Marker centre 96px, -5 tick centre 80px: 3px of clearance past touching, a quarter of a
      // 12px tick height.
      await waitFor(() => expect(tickByLabel(container, "-5").style.opacity).toBe("0.25"));
      expect(tickByLabel(container, "-10").style.opacity).toBe("");
      expect(tickByLabel(container, "0").style.opacity).toBe("");
    });

    it("hides a tick the TP Max marker sits on", async () => {
      stubAxisLayout();
      const { container } = renderPanel({
        displayAudio: { peakDb: [-9, -9], tpMax: -4.6 },
        panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
      });

      await waitFor(() => expect(tickByLabel(container, "-5").style.opacity).toBe("0"));
    });

    it("fades the tick under the loudness value marker the same way", async () => {
      stubAxisLayout();
      const { container } = renderPanel({
        displayAudio: { peakDb: [-9, -9], momentary: -20 },
        panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: true },
      });

      await waitFor(() => expect(tickByLabel(container, "-20").style.opacity).toBe("0"));
      expect(tickByLabel(container, "-30").style.opacity).toBe("");
    });

    it("leaves every tick alone when no marker is shown", async () => {
      stubAxisLayout();
      const { container } = renderPanel({
        displayAudio: { peakDb: [-9, -9], tpMax: -4.6 },
        panelControls: { levelMeterMode: "peak", levelMeterTpMaxMarker: false },
      });

      const scale = container.querySelector("[data-level-meter-y-axis-scale]");
      await waitFor(() => expect(tickByLabel(container, "-5")).toBeTruthy());
      for (const tick of scale.children)
        expect(/** @type {HTMLElement} */ (tick).style.opacity).toBe("");
    });
  });

  it("reveals a gradient fixed to the full bar instead of squashing it into the fill", () => {
    const { container } = renderPanel({ displayAudio: { peakDb: [-9.9, -9.9] } });

    const gradient = container.querySelector("[data-level-meter-gradient]");
    expect(/** @type {HTMLElement} */ (gradient).style.transform).not.toMatch(/scale/);
    const topInsetPct = parseFloat(
      /** @type {HTMLElement} */ (gradient).style.clipPath.match(/inset\(([-\d.]+)%/)[1]
    );
    expect(topInsetPct).toBeCloseTo(((3 - -9.9) / 63) * 100, 3);
  });

  it("anchors the Peak colours to the Peak thresholds in the visible range", () => {
    const { container } = renderPanel({
      panelControls: {
        levelMeterMode: "peak",
        levelMeterBarColors: "levelZones",
        levelMeterPeakWarningDb: -12,
        levelMeterPeakCriticalDb: -3,
        levelMeterYMinDb: -30,
        levelMeterYMaxDb: 0,
      },
    });

    const gradient = container.querySelector("[data-level-meter-gradient]");
    expect(/** @type {HTMLElement} */ (gradient).dataset.levelMeterGradient).toBe(
      zonesToGradient(thresholdZones(-12, -3), -30, 0, "to top")
    );
  });

  it("uses the RMS thresholds in RMS mode", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "rms", levelMeterBarColors: "levelZones" },
    });
    expect(
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-gradient]")).dataset
        .levelMeterGradient
    ).toBe(zonesToGradient(thresholdZones(-18, -9), -60, 3, "to top"));
  });

  it("shows the Momentary trace colour under the starter Profile, which has no Momentary rule", () => {
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterBarColors: "levelZones" },
    });
    expect(
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-gradient]")).dataset
        .levelMeterGradient
    ).toBe("linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))");
  });

  it("shows the Momentary trace colour under Profile Off", () => {
    settingsStore.patch({
      loudnessProfiles: { active: LOUDNESS_PROFILE_OFF, profiles: [TEST_PROFILE] },
    });
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterBarColors: "levelZones" },
    });
    expect(
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-gradient]")).dataset
        .levelMeterGradient
    ).toBe("linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))");
  });

  it("follows a Momentary Max ceiling from the active Profile", () => {
    const profileWithCeiling = {
      ...TEST_PROFILE,
      rules: [{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }],
    };
    settingsStore.patch({
      loudnessProfiles: {
        active: profileSelectionId(profileWithCeiling.id),
        profiles: [profileWithCeiling],
      },
    });
    const { container } = renderPanel({
      panelControls: { levelMeterMode: "momentary", levelMeterBarColors: "levelZones" },
    });

    expect(
      /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-gradient]")).dataset
        .levelMeterGradient
    ).toBe(zonesToGradient(profileZones(profileWithCeiling, "momentary"), -64, 0, "to top"));
  });

  it("draws the Gradient by default and ignores the Profile there", () => {
    const profileWithCeiling = {
      ...TEST_PROFILE,
      rules: [{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }],
    };
    settingsStore.patch({
      loudnessProfiles: {
        active: profileSelectionId(profileWithCeiling.id),
        profiles: [profileWithCeiling],
      },
    });
    const gradient =
      "linear-gradient(to top, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, " +
      "var(--ui-level-critical) 100%)";
    for (const levelMeterMode of ["peak", "momentary"]) {
      const { container, unmount } = renderPanel({ panelControls: { levelMeterMode } });
      expect(
        /** @type {HTMLElement} */ (container.querySelector("[data-level-meter-gradient]")).dataset
          .levelMeterGradient
      ).toBe(gradient);
      unmount();
    }
  });

  it("colours the Floating Value by Playback Max against a Momentary Max ceiling", async () => {
    const profileWithCeiling = {
      ...TEST_PROFILE,
      rules: [{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }],
    };
    settingsStore.patch({
      loudnessProfiles: {
        active: profileSelectionId(profileWithCeiling.id),
        profiles: [profileWithCeiling],
      },
    });
    const { container } = renderPanel({
      displayAudio: { peakDb: [-9, -9], momentary: -12 },
      panelControls: {
        levelMeterMode: "momentary",
        levelMeterPlaybackMax: true,
        levelMeterValueMarker: true,
      },
    });

    const marker = container.querySelector("[data-level-value-marker]");
    await waitFor(() => expect(marker.textContent).toBe("-12.0"));
    expect(marker.getAttribute("data-loudness-status")).toBe("fail");
  });
});
