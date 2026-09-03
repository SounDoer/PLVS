import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { planPublicPanelControlPatch } from "./panelControlPatch.js";

describe("planPublicPanelControlPatch", () => {
  it("maps a valid Level Meter patch without changing unrelated stored controls", () => {
    const current = { ...DEFAULT_PANEL_CONTROLS, spectrumSpeedPercent: 70 };
    const result = planPublicPanelControlPatch("levelMeter", current, {
      mode: "shortTerm",
      loudnessRangeLufs: { min: -48, max: -6 },
    });

    expect(result).toMatchObject({
      issues: [],
      changed: [
        "controls.mode",
        "controls.loudnessRangeLufs.min",
        "controls.loudnessRangeLufs.max",
      ],
      warnings: [],
    });
    expect(result.panelControls).toMatchObject({
      levelMeterMode: "shortTerm",
      loudnessYMinDb: -48,
      loudnessYMaxDb: -6,
      spectrumSpeedPercent: 70,
    });
  });

  it("returns every independent Level Meter issue without planning a partial mutation", () => {
    const current = { ...DEFAULT_PANEL_CONTROLS };
    const result = planPublicPanelControlPatch("levelMeter", current, {
      unknown: true,
      mode: "vu",
      playbackMax: "yes",
    });

    expect(result.issues).toEqual([
      expect.objectContaining({ code: "unknownControl", path: "$.unknown" }),
      expect.objectContaining({ code: "invalidEnum", path: "$.mode" }),
      expect.objectContaining({ code: "invalidType", path: "$.playbackMax" }),
    ]);
    expect(result.changed).toEqual([]);
    expect(result.panelControls).toEqual(current);
  });

  it("warns when a touched Level Meter control is inactive in the final mode", () => {
    const result = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
      playbackMax: true,
    });

    expect(result.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "controls.playbackMax",
        inactiveReason: "peakMode",
      },
    ]);
  });

  it("maps a valid Vectorscope patch", () => {
    const result = planPublicPanelControlPatch(
      "vectorscope",
      DEFAULT_PANEL_CONTROLS,
      {
        channelPair: { x: 2, y: 5 },
        mode: "polarLevel",
        maxHold: true,
      },
      { channelCount: 6 }
    );

    expect(result).toMatchObject({
      issues: [],
      warnings: [],
      changed: [
        "controls.channelPair.x",
        "controls.channelPair.y",
        "controls.mode",
        "controls.maxHold",
      ],
    });
    expect(result.panelControls).toMatchObject({
      vectorscopePair: { x: 2, y: 5 },
      vectorscopeMode: "polarLevel",
      vectorscopePolarLevelMaxHold: true,
    });
  });

  it("rejects an unavailable or reversed Vectorscope pair atomically", () => {
    const result = planPublicPanelControlPatch(
      "vectorscope",
      DEFAULT_PANEL_CONTROLS,
      { channelPair: { x: 2, y: 1 } },
      { channelCount: 2 }
    );

    expect(result.issues).toEqual([
      expect.objectContaining({ code: "outOfRange", path: "$.channelPair" }),
    ]);
    expect(result.changed).toEqual([]);
    expect(result.panelControls).toEqual(DEFAULT_PANEL_CONTROLS);
  });

  it("warns when Vectorscope Max Hold is configured outside Polar Level", () => {
    const result = planPublicPanelControlPatch("vectorscope", DEFAULT_PANEL_CONTROLS, {
      maxHold: true,
    });

    expect(result.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "controls.maxHold",
        inactiveReason: "nonPolarLevelMode",
      },
    ]);
  });
});
