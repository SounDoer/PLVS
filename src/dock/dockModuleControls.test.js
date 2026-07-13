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
    expect(controls.stats.ids).not.toBe(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.ids);
  });

  it("migrates legacy statsIds only when new stats controls are absent", () => {
    expect(normalizeDockControlsByModuleId({}, ["psr", "lra"]).stats.ids).toEqual(["psr", "lra"]);
    expect(
      normalizeDockControlsByModuleId({ stats: { ids: ["integrated"] } }, ["psr"]).stats.ids
    ).toEqual(["integrated"]);
  });

  it("normalizes each family without retaining unrelated fields", () => {
    const controls = normalizeDockControlsByModuleId({
      loudness: { metric: "integrated", showSparkline: false, referenceLufs: -18, junk: true },
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
      metric: "integrated",
      showSparkline: false,
      showReference: false,
      referenceLufs: -18,
    });
    expect(controls.spectrum).toMatchObject({
      channel: { type: "single", ch: 3 },
      view: "ms",
      smoothingPercent: 100,
      tiltDbPerOctave: 0,
      peakHold: true,
      minDb: -96,
      maxDb: -12,
    });
    expect(controls.waveform).toEqual({ view: "single", channel: 4, windowSec: 120 });
  });
});

describe("normalizeDockModuleControls", () => {
  it("rejects invalid channel pairs and caps stats at four known ids", () => {
    expect(normalizeDockModuleControls("correlation", { pair: { x: 2, y: 2 } }).pair).toEqual({
      x: 0,
      y: 1,
    });
    expect(
      normalizeDockModuleControls("stats", {
        ids: ["truePeak", "ghost", "lra", "truePeak", "integrated", "psr", "plr"],
      }).ids
    ).toEqual(["truePeak", "lra", "integrated", "psr"]);
  });

  it("returns null for modules without controls", () => {
    expect(normalizeDockModuleControls("transport", {})).toBeNull();
  });
});

describe("updateDockModuleControls", () => {
  it("updates one cloned family and ignores unknown ids", () => {
    const controls = normalizeDockControlsByModuleId();
    const next = updateDockModuleControls(controls, "loudness", { metric: "momentary" });
    expect(next.loudness.metric).toBe("momentary");
    expect(next.spectrum).toBe(controls.spectrum);
    expect(updateDockModuleControls(controls, "ghost", {})).toBe(controls);
  });
});
