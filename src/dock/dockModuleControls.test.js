import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  DOCK_CONTROL_MODULE_IDS,
  isDefaultDockModuleControls,
  normalizeDockControlsByModuleId,
  normalizeDockModuleControls,
  updateDockModuleControls,
} from "./dockModuleControls.js";

describe("normalizeDockControlsByModuleId", () => {
  it("shares normal defaults for every overlapping Dock control", () => {
    const controls = normalizeDockControlsByModuleId();

    expect(controls.level.levelMeterMode).toBe(DEFAULT_PANEL_CONTROLS.levelMeterMode);
    expect(controls.loudness).toMatchObject({
      loudnessYMinDb: DEFAULT_PANEL_CONTROLS.loudnessYMinDb,
      loudnessYMaxDb: DEFAULT_PANEL_CONTROLS.loudnessYMaxDb,
    });
    expect(controls.loudness.loudnessHistoryVisibleLayerIds).toEqual(
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    );
    expect(controls.spectrum).toMatchObject({
      spectrumChannel: DEFAULT_PANEL_CONTROLS.spectrumChannel,
      spectrumView: DEFAULT_PANEL_CONTROLS.spectrumView,
      spectrumSpeedPercent: DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent,
      spectrumOctaveSmoothing: DEFAULT_PANEL_CONTROLS.spectrumOctaveSmoothing,
      spectrumTiltDbPerOctave: DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave,
      spectrumMaxMode: DEFAULT_PANEL_CONTROLS.spectrumMaxMode,
      spectrumXMinFreq: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
      spectrumXMaxFreq: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
      spectrumYMinDb: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
      spectrumYMaxDb: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
    });
    expect(controls.correlation).toMatchObject({
      vectorscopePair: DEFAULT_PANEL_CONTROLS.vectorscopePair,
      vectorscopeMode: DEFAULT_PANEL_CONTROLS.vectorscopeMode,
      vectorscopePolarLevelMaxHold: DEFAULT_PANEL_CONTROLS.vectorscopePolarLevelMaxHold,
    });
    expect(controls.spectrogram).toMatchObject({
      spectrumChannel: DEFAULT_PANEL_CONTROLS.spectrumChannel,
      spectrogramYMinFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
      spectrogramYMaxFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
    });

    expect(controls.loudness.loudnessHistoryVisibleLayerIds).not.toBe(
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    );
    expect(controls.spectrum.spectrumChannel).not.toBe(DEFAULT_PANEL_CONTROLS.spectrumChannel);
    expect(controls.correlation.vectorscopePair).not.toBe(DEFAULT_PANEL_CONTROLS.vectorscopePair);
    expect(controls.spectrogram.spectrumChannel).not.toBe(DEFAULT_PANEL_CONTROLS.spectrumChannel);
  });

  it("shares the normal Stats default order and visible metrics", () => {
    const stats = normalizeDockControlsByModuleId().stats;
    expect(stats.statsOrder).toEqual(DEFAULT_PANEL_CONTROLS.statsOrder);
    expect(stats.statsVisibleIds).toEqual(DEFAULT_PANEL_CONTROLS.statsVisibleIds);
    expect(stats.statsOrder).not.toBe(DEFAULT_PANEL_CONTROLS.statsOrder);
    expect(stats.statsVisibleIds).not.toBe(DEFAULT_PANEL_CONTROLS.statsVisibleIds);
  });

  it("detects defaults after normalization", () => {
    expect(isDefaultDockModuleControls("level", { levelMeterMode: "peak" })).toBe(true);
    expect(isDefaultDockModuleControls("level", { levelMeterMode: "rms" })).toBe(false);
  });

  it("returns cloned defaults for junk input", () => {
    const controls = normalizeDockControlsByModuleId(null);
    expect(controls.spectrum).toEqual(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum);
    expect(controls.spectrum).not.toBe(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum);
    expect(controls.spectrum.spectrumChannel).not.toBe(
      DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum.spectrumChannel
    );
    expect(controls.stats.statsVisibleIds).not.toBe(
      DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.statsVisibleIds
    );
    expect(controls.stats.statsOrder).not.toBe(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.statsOrder);
    expect(controls.loudness.loudnessHistoryVisibleLayerIds).not.toBe(
      DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness.loudnessHistoryVisibleLayerIds
    );
  });

  it("normalizes each family without retaining unrelated fields", () => {
    const controls = normalizeDockControlsByModuleId({
      loudness: {
        loudnessHistoryVisibleLayerIds: ["shortTerm", "ghost", "shortTerm"],
        loudnessYMinDb: -42,
        loudnessYMaxDb: -12,
        junk: true,
      },
      spectrum: {
        channel: { type: "single", ch: 3.8 },
        view: "ms",
        speedPercent: 140,
        octaveSmoothing: "1/6",
        tiltDbPerOctave: -2,
        maxHold: true,
        minDb: -30,
        maxDb: -25,
      },
      waveform: { view: "single", channel: 4.9, windowSec: 200 },
    });
    expect(controls.loudness).toEqual({
      showReadouts: true,
      loudnessHistoryVisibleLayerIds: ["shortTerm"],
      loudnessYMinDb: -42,
      loudnessYMaxDb: -12,
    });
    expect(controls.spectrum).toMatchObject({
      spectrumChannel: { type: "single", ch: 3 },
      spectrumView: "ms",
      spectrumSpeedPercent: 100,
      spectrumOctaveSmoothing: "1/6",
      spectrumTiltDbPerOctave: 0,
      spectrumMaxMode: "decay",
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
      // A stored range narrower than the control's minimum span is opened up around the bound the
      // caller supplied, not reset to the default range: the Dock reads the same row as the
      // Workspace panel, and that is the row's rule.
      spectrumYMinDb: -30,
      spectrumYMaxDb: -18,
    });
    expect(controls.waveform).toEqual({
      waveformFrequencyColor: false,
      waveformLowMidSplitHz: 200,
      waveformMidHighSplitHz: 2000,
      waveformCentroid: false,
    });
  });

  it("drops the legacy Dock Loudness reference and adopts the normal layer defaults", () => {
    expect(
      normalizeDockControlsByModuleId({
        loudness: {
          metric: "integrated",
          showSparkline: false,
          showReference: false,
          referenceLufs: -18,
        },
      }).loudness
    ).toEqual({
      showReadouts: true,
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
      loudnessYMinDb: -64,
      loudnessYMaxDb: 0,
    });
  });

  it("migrates legacy Spectrum time-axis control names", () => {
    const controls = normalizeDockControlsByModuleId({
      spectrum: { smoothingPercent: 72, peakHold: true },
    }).spectrum;

    expect(controls).toMatchObject({
      spectrumSpeedPercent: 72,
      spectrumOctaveSmoothing: "off",
      spectrumMaxMode: "decay",
    });
    expect(controls).not.toHaveProperty("smoothingPercent");
    expect(controls).not.toHaveProperty("peakHold");
  });
});

describe("Stereo Map Dock control family", () => {
  it("registers stereoMap as an independent control family", () => {
    expect(DOCK_CONTROL_MODULE_IDS).toContain("stereoMap");
    expect(normalizeDockControlsByModuleId().stereoMap).toEqual(
      DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap
    );
  });

  it("updates only the stereoMap family and leaves the others untouched", () => {
    const controls = normalizeDockControlsByModuleId();
    const next = updateDockModuleControls(controls, "stereoMap", {
      ...controls.stereoMap,
      stereoMapPair: { x: 2, y: 3 },
    });
    expect(next.stereoMap.stereoMapPair).toEqual({ x: 2, y: 3 });
    expect(next.correlation).toBe(controls.correlation);
    expect(next.spectrum).toBe(controls.spectrum);
  });
});

describe("normalizeDockModuleControls", () => {
  it("defaults Loudness readouts on and preserves an explicit hidden state", () => {
    expect(normalizeDockModuleControls("loudness", {}).showReadouts).toBe(true);
    expect(normalizeDockModuleControls("loudness", { showReadouts: false }).showReadouts).toBe(
      false
    );
  });

  it("defaults Level to live Peak and migrates legacy readouts", () => {
    expect(normalizeDockModuleControls("level", {})).toEqual({
      levelMeterMode: "peak",
      readout: "live",
      showLabels: true,
    });
    expect(normalizeDockModuleControls("level", { readout: "peak" }).readout).toBe("live");
    expect(normalizeDockModuleControls("level", { readout: "truePeakMax" })).toMatchObject({
      levelMeterMode: "peak",
      readout: "truePeakMax",
    });
    expect(normalizeDockModuleControls("level", { showChannelLabels: false }).showLabels).toBe(
      false
    );
  });

  it("keeps detector-specific Level readouts valid", () => {
    expect(
      normalizeDockModuleControls("level", { levelMeterMode: "rms", readout: "playbackMax" })
    ).toMatchObject({ levelMeterMode: "rms", readout: "playbackMax" });
    expect(
      normalizeDockModuleControls("level", { levelMeterMode: "shortTerm", readout: "truePeakMax" })
        .readout
    ).toBe("live");
  });

  it("rejects invalid channel pairs and normalizes unlimited Stats visibility and order", () => {
    expect(
      normalizeDockModuleControls("correlation", { vectorscopePair: { x: 2, y: 2 } })
        .vectorscopePair
    ).toEqual({ x: 0, y: 1 });
    const stats = normalizeDockModuleControls("stats", {
      statsVisibleIds: ["truePeak", "ghost", "lra", "truePeak", "integrated", "psr", "plr"],
      statsOrder: ["plr", "psr", "ghost", "plr", "integrated"],
    });
    expect(stats.statsVisibleIds).toEqual(["truePeak", "lra", "integrated", "psr", "plr"]);
    expect(stats.statsOrder.slice(0, 3)).toEqual(["plr", "psr", "integrated"]);
    expect(stats.statsOrder).toHaveLength(15);
  });

  it("normalizes Vectorscope display controls", () => {
    expect(
      normalizeDockModuleControls("correlation", {
        vectorscopePair: { x: 2, y: 3 },
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: true,
      })
    ).toEqual({
      vectorscopePair: { x: 2, y: 3 },
      vectorscopeMode: "polarLevel",
      vectorscopePolarLevelMaxHold: true,
    });
    expect(
      normalizeDockModuleControls("correlation", {
        vectorscopeMode: "unknown",
        vectorscopePolarLevelMaxHold: "yes",
      })
    ).toMatchObject({ vectorscopeMode: "lissajous", vectorscopePolarLevelMaxHold: false });
  });

  it("reads the legacy polarLevelPeakHold key as a fallback", () => {
    expect(
      normalizeDockModuleControls("correlation", {
        vectorscopeMode: "polarLevel",
        polarLevelPeakHold: true,
      })
    ).toMatchObject({ vectorscopePolarLevelMaxHold: true });
  });

  it("carries the Max mode in the Dock Spectrum subset", () => {
    expect(
      normalizeDockModuleControls("spectrum", { spectrumMaxMode: "hold" }).spectrumMaxMode
    ).toBe("hold");
    expect(normalizeDockModuleControls("spectrum", {}).spectrumMaxMode).toBe("off");
  });

  it("returns null for modules without controls", () => {
    expect(normalizeDockModuleControls("transport", {})).toBeNull();
  });

  it("normalizes Dock Waveform spectral controls", () => {
    expect(normalizeDockModuleControls("waveform", {})).toEqual({
      waveformFrequencyColor: false,
      waveformLowMidSplitHz: 200,
      waveformMidHighSplitHz: 2000,
      waveformCentroid: false,
    });
    expect(
      normalizeDockModuleControls("waveform", {
        waveformFrequencyColor: true,
        waveformLowMidSplitHz: 315.4,
        waveformMidHighSplitHz: 4100.2,
        waveformCentroid: true,
      })
    ).toEqual({
      waveformFrequencyColor: true,
      waveformLowMidSplitHz: 315,
      waveformMidHighSplitHz: 4100,
      waveformCentroid: true,
    });
    expect(
      normalizeDockModuleControls("waveform", {
        waveformLowMidSplitHz: 5000,
        waveformMidHighSplitHz: 1000,
      })
    ).toMatchObject({ waveformLowMidSplitHz: 200, waveformMidHighSplitHz: 2000 });
  });

  it("normalizes Stereo Map controls independently from Workspace panel control names", () => {
    // Dock's Stereo Map controls are a separate family (keyed "stereoMap" here vs. the Workspace
    // panel's "stereoMap*"-prefixed fields in lib/panelControls.js) — one instance's toggles must
    // never bleed into the other's normalized shape.
    expect(normalizeDockModuleControls("stereoMap", {})).toEqual({
      stereoMapPair: { x: 0, y: 1 },
      stereoMapMode: "position",
      stereoMapHold: false,
      stereoMapSpeedPercent: 50,
      stereoMapOctaveSmoothing: "1/12",
      stereoMapXMinFreq: 20,
      stereoMapXMaxFreq: 20000,
      stereoMapMonoLossYMinDb: -24,
      stereoMapMsRatioYMinDb: -48,
      stereoMapMsRatioYMaxDb: 24,
    });
    expect(
      normalizeDockModuleControls("stereoMap", {
        stereoMapPair: { x: 2, y: 3 },
        stereoMapMode: "correlation",
        stereoMapHold: true,
        stereoMapSpeedPercent: 80,
        stereoMapOctaveSmoothing: "1/3",
        stereoMapXMinFreq: 40,
        stereoMapXMaxFreq: 16000,
        stereoMapMonoLossYMinDb: -30,
        stereoMapMsRatioYMinDb: -20,
        stereoMapMsRatioYMaxDb: 10,
      })
    ).toEqual({
      stereoMapPair: { x: 2, y: 3 },
      stereoMapMode: "correlation",
      stereoMapHold: true,
      stereoMapSpeedPercent: 80,
      stereoMapOctaveSmoothing: "1/3",
      stereoMapXMinFreq: 40,
      stereoMapXMaxFreq: 16000,
      stereoMapMonoLossYMinDb: -30,
      stereoMapMsRatioYMinDb: -20,
      stereoMapMsRatioYMaxDb: 10,
    });
  });

  it("rejects an invalid Stereo Map channel pair and unknown mode", () => {
    expect(
      normalizeDockModuleControls("stereoMap", { stereoMapPair: { x: 2, y: 2 } }).stereoMapPair
    ).toEqual({ x: 0, y: 1 });
    expect(
      normalizeDockModuleControls("stereoMap", { stereoMapMode: "unknown" }).stereoMapMode
    ).toBe("position");
  });

  it("keeps Stereo Map's M/S Ratio Y range straddling zero", () => {
    expect(
      normalizeDockModuleControls("stereoMap", {
        stereoMapMsRatioYMinDb: 10,
        stereoMapMsRatioYMaxDb: -10,
      })
    ).toMatchObject({ stereoMapMsRatioYMinDb: 0, stereoMapMsRatioYMaxDb: 0 });
  });
});

describe("updateDockModuleControls", () => {
  it("updates one cloned family and ignores unknown ids", () => {
    const controls = normalizeDockControlsByModuleId();
    const next = updateDockModuleControls(controls, "loudness", {
      ...controls.loudness,
      loudnessHistoryVisibleLayerIds: ["momentary"],
    });
    expect(next.loudness.loudnessHistoryVisibleLayerIds).toEqual(["momentary"]);
    expect(next.spectrum).toBe(controls.spectrum);
    expect(updateDockModuleControls(controls, "ghost", {})).toBe(controls);
  });
});
