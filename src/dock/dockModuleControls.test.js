import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  isDefaultDockModuleControls,
  normalizeDockControlsByModuleId,
  normalizeDockModuleControls,
  updateDockModuleControls,
} from "./dockModuleControls.js";

describe("normalizeDockControlsByModuleId", () => {
  it("shares normal defaults for every overlapping Dock control", () => {
    const controls = normalizeDockControlsByModuleId();

    expect(controls.level.mode).toBe(DEFAULT_PANEL_CONTROLS.levelMeterMode);
    expect(controls.loudness).toMatchObject({
      loudnessYMinDb: DEFAULT_PANEL_CONTROLS.loudnessYMinDb,
      loudnessYMaxDb: DEFAULT_PANEL_CONTROLS.loudnessYMaxDb,
    });
    expect(controls.loudness.loudnessHistoryVisibleLayerIds).toEqual(
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    );
    expect(controls.spectrum).toMatchObject({
      channel: DEFAULT_PANEL_CONTROLS.spectrumChannel,
      view: DEFAULT_PANEL_CONTROLS.spectrumView,
      speedPercent: DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent,
      octaveSmoothing: DEFAULT_PANEL_CONTROLS.spectrumOctaveSmoothing,
      tiltDbPerOctave: DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave,
      maxHold: DEFAULT_PANEL_CONTROLS.spectrumMaxHold,
      minFreq: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
      maxFreq: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
      minDb: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
      maxDb: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
    });
    expect(controls.correlation.pair).toEqual(DEFAULT_PANEL_CONTROLS.vectorscopePair);
    expect(controls.spectrogram).toMatchObject({
      channel: DEFAULT_PANEL_CONTROLS.spectrumChannel,
      minFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
      maxFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
    });

    expect(controls.loudness.loudnessHistoryVisibleLayerIds).not.toBe(
      DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds
    );
    expect(controls.spectrum.channel).not.toBe(DEFAULT_PANEL_CONTROLS.spectrumChannel);
    expect(controls.correlation.pair).not.toBe(DEFAULT_PANEL_CONTROLS.vectorscopePair);
    expect(controls.spectrogram.channel).not.toBe(DEFAULT_PANEL_CONTROLS.spectrumChannel);
  });

  it("shares the normal Stats default order and visible metrics", () => {
    const stats = normalizeDockControlsByModuleId().stats;
    expect(stats.statsOrder).toEqual(DEFAULT_PANEL_CONTROLS.statsOrder);
    expect(stats.statsVisibleIds).toEqual(DEFAULT_PANEL_CONTROLS.statsVisibleIds);
    expect(stats.statsOrder).not.toBe(DEFAULT_PANEL_CONTROLS.statsOrder);
    expect(stats.statsVisibleIds).not.toBe(DEFAULT_PANEL_CONTROLS.statsVisibleIds);
  });

  it("detects defaults after normalization", () => {
    expect(isDefaultDockModuleControls("level", { mode: "peak" })).toBe(true);
    expect(isDefaultDockModuleControls("level", { mode: "rms" })).toBe(false);
  });

  it("returns cloned defaults for junk input", () => {
    const controls = normalizeDockControlsByModuleId(null);
    expect(controls.spectrum).toEqual(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum);
    expect(controls.spectrum).not.toBe(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum);
    expect(controls.spectrum.channel).not.toBe(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum.channel);
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
      channel: { type: "single", ch: 3 },
      view: "ms",
      speedPercent: 100,
      octaveSmoothing: "1/6",
      tiltDbPerOctave: 0,
      maxHold: true,
      minFreq: 20,
      maxFreq: 20000,
      minDb: -96,
      maxDb: -12,
    });
    expect(controls.waveform).toBeUndefined();
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
      speedPercent: 72,
      octaveSmoothing: "off",
      maxHold: true,
    });
    expect(controls).not.toHaveProperty("smoothingPercent");
    expect(controls).not.toHaveProperty("peakHold");
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
      mode: "peak",
      readout: "live",
      showLabels: true,
    });
    expect(normalizeDockModuleControls("level", { readout: "peak" }).readout).toBe("live");
    expect(normalizeDockModuleControls("level", { readout: "truePeakMax" })).toMatchObject({
      mode: "peak",
      readout: "truePeakMax",
    });
    expect(normalizeDockModuleControls("level", { showChannelLabels: false }).showLabels).toBe(
      false
    );
  });

  it("keeps detector-specific Level readouts valid", () => {
    expect(
      normalizeDockModuleControls("level", { mode: "rms", readout: "playbackMax" })
    ).toMatchObject({ mode: "rms", readout: "playbackMax" });
    expect(
      normalizeDockModuleControls("level", { mode: "shortTerm", readout: "truePeakMax" }).readout
    ).toBe("live");
  });

  it("rejects invalid channel pairs and normalizes unlimited Stats visibility and order", () => {
    expect(normalizeDockModuleControls("correlation", { pair: { x: 2, y: 2 } }).pair).toEqual({
      x: 0,
      y: 1,
    });
    const stats = normalizeDockModuleControls("stats", {
      statsVisibleIds: ["truePeak", "ghost", "lra", "truePeak", "integrated", "psr", "plr"],
      statsOrder: ["plr", "psr", "ghost", "plr", "integrated"],
    });
    expect(stats.statsVisibleIds).toEqual(["truePeak", "lra", "integrated", "psr", "plr"]);
    expect(stats.statsOrder.slice(0, 3)).toEqual(["plr", "psr", "integrated"]);
    expect(stats.statsOrder).toHaveLength(15);
  });

  it("returns null for modules without controls", () => {
    expect(normalizeDockModuleControls("transport", {})).toBeNull();
    expect(normalizeDockModuleControls("waveform", {})).toBeNull();
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
