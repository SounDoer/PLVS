import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockControlsByModuleId,
  normalizeDockModuleControls,
  updateDockModuleControls,
} from "./dockModuleControls.js";

describe("normalizeDockControlsByModuleId", () => {
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
        loudnessReferenceLufs: -18,
        loudnessHistoryVisibleLayerIds: ["shortTerm", "ghost", "shortTerm"],
        loudnessYMinDb: -42,
        loudnessYMaxDb: -12,
        junk: true,
      },
      spectrum: {
        channel: { type: "single", ch: 3.8 },
        view: "ms",
        smoothingPercent: 140,
        tiltDbPerOctave: -2,
        peakHold: true,
        minDb: -30,
        maxDb: -25,
      },
      waveform: { view: "single", channel: 4.9, windowSec: 200 },
    });
    expect(controls.loudness).toEqual({
      loudnessReferenceLufs: -18,
      loudnessHistoryVisibleLayerIds: ["shortTerm"],
      loudnessYMinDb: -42,
      loudnessYMaxDb: -12,
    });
    expect(controls.spectrum).toMatchObject({
      channel: { type: "single", ch: 3 },
      view: "ms",
      smoothingPercent: 100,
      tiltDbPerOctave: 0,
      peakHold: true,
      minFreq: 20,
      maxFreq: 20000,
      minDb: -96,
      maxDb: -12,
    });
    expect(controls.waveform).toBeUndefined();
  });

  it("migrates the legacy Dock Loudness reference and adopts the normal layer defaults", () => {
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
      loudnessReferenceLufs: -18,
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
      loudnessYMinDb: -64,
      loudnessYMaxDb: 0,
    });
  });
});

describe("normalizeDockModuleControls", () => {
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
