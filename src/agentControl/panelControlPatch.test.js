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

  it("maps a valid Waveform patch", () => {
    const result = planPublicPanelControlPatch("waveform", DEFAULT_PANEL_CONTROLS, {
      frequencyColor: true,
      frequencyBandsHz: { lowMid: 300, midHigh: 3000 },
      centroid: true,
    });

    expect(result).toMatchObject({
      issues: [],
      warnings: [],
      changed: [
        "controls.frequencyColor",
        "controls.frequencyBandsHz.lowMid",
        "controls.frequencyBandsHz.midHigh",
        "controls.centroid",
      ],
    });
    expect(result.panelControls).toMatchObject({
      waveformFrequencyColor: true,
      waveformLowMidSplitHz: 300,
      waveformMidHighSplitHz: 3000,
      waveformCentroid: true,
    });
  });

  it("rejects invalid Waveform bands and warns for dormant valid bands", () => {
    const invalid = planPublicPanelControlPatch("waveform", DEFAULT_PANEL_CONTROLS, {
      frequencyBandsHz: { lowMid: 2000, midHigh: 200 },
    });
    expect(invalid.issues).toEqual([
      expect.objectContaining({ code: "outOfRange", path: "$.frequencyBandsHz" }),
    ]);
    expect(invalid.changed).toEqual([]);

    const dormant = planPublicPanelControlPatch("waveform", DEFAULT_PANEL_CONTROLS, {
      frequencyBandsHz: { lowMid: 300, midHigh: 3000 },
    });
    expect(dormant.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "controls.frequencyBandsHz",
        inactiveReason: "frequencyColorOff",
      },
    ]);
  });

  it("maps a valid Loudness layer and range patch", () => {
    const result = planPublicPanelControlPatch(
      "loudness",
      DEFAULT_PANEL_CONTROLS,
      {
        layers: ["shortTerm", "reference"],
        loudnessRangeLufs: { min: -48, max: -6 },
      },
      { hasLoudnessReference: true }
    );

    expect(result).toMatchObject({
      issues: [],
      warnings: [],
      changed: [
        "controls.layers",
        "controls.loudnessRangeLufs.min",
        "controls.loudnessRangeLufs.max",
      ],
    });
    expect(result.panelControls).toMatchObject({
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
      loudnessYMinDb: -48,
      loudnessYMaxDb: -6,
    });
  });

  it("preserves hidden Loudness reference preference and rejects selecting it while unavailable", () => {
    const hidden = planPublicPanelControlPatch(
      "loudness",
      DEFAULT_PANEL_CONTROLS,
      { layers: ["momentary"] },
      { hasLoudnessReference: false }
    );
    expect(hidden.issues).toEqual([]);
    expect(hidden.panelControls.loudnessHistoryVisibleLayerIds).toEqual(["momentary", "ref"]);

    const unavailable = planPublicPanelControlPatch(
      "loudness",
      DEFAULT_PANEL_CONTROLS,
      { layers: ["reference"] },
      { hasLoudnessReference: false }
    );
    expect(unavailable.issues).toEqual([
      expect.objectContaining({ code: "controlUnavailable", path: "$.layers" }),
    ]);
    expect(unavailable.changed).toEqual([]);
  });

  it("maps a partial Stats metrics patch and canonicalizes visible order", () => {
    const result = planPublicPanelControlPatch("stats", DEFAULT_PANEL_CONTROLS, {
      metrics: { visible: ["truePeak", "momentary"] },
    });

    expect(result).toMatchObject({
      issues: [],
      warnings: [],
      changed: ["controls.metrics.visible"],
    });
    expect(result.panelControls.statsVisibleIds).toEqual(["momentary", "truePeak"]);
    expect(result.panelControls.statsOrder).toEqual(DEFAULT_PANEL_CONTROLS.statsOrder);
  });

  it("requires a complete Stats order and reflects order changes in visible output", () => {
    const invalid = planPublicPanelControlPatch("stats", DEFAULT_PANEL_CONTROLS, {
      metrics: { order: ["momentary"] },
    });
    expect(invalid.issues).toEqual([
      expect.objectContaining({ code: "invalidEnum", path: "$.metrics.order" }),
    ]);
    expect(invalid.changed).toEqual([]);

    const reversed = [...DEFAULT_PANEL_CONTROLS.statsOrder].reverse();
    const valid = planPublicPanelControlPatch("stats", DEFAULT_PANEL_CONTROLS, {
      metrics: { order: reversed },
    });
    expect(valid.changed).toEqual(["controls.metrics.visible", "controls.metrics.order"]);
    expect(valid.panelControls.statsVisibleIds).toEqual(
      [...DEFAULT_PANEL_CONTROLS.statsVisibleIds].reverse()
    );
  });

  it("maps valid Spectrum display controls", () => {
    const result = planPublicPanelControlPatch("spectrum", DEFAULT_PANEL_CONTROLS, {
      view: "ms",
      maxMode: "hold",
      peakLabels: true,
      speedPercent: 70,
      tiltDbPerOctave: 4.5,
      octaveSmoothing: "1/6",
      levelRangeDb: { min: -72, max: -6 },
    });

    expect(result).toMatchObject({
      issues: [],
      warnings: [],
      changed: [
        "controls.view",
        "controls.maxMode",
        "controls.peakLabels",
        "controls.speedPercent",
        "controls.tiltDbPerOctave",
        "controls.octaveSmoothing",
        "controls.levelRangeDb.min",
        "controls.levelRangeDb.max",
      ],
    });
    expect(result.panelControls).toMatchObject({
      spectrumView: "ms",
      spectrumMaxMode: "hold",
      spectrumPeakLabels: true,
      spectrumSpeedPercent: 70,
      spectrumTiltDbPerOctave: 4.5,
      spectrumOctaveSmoothing: "1/6",
      spectrumYMinDb: -72,
      spectrumYMaxDb: -6,
    });
  });

  it("validates Spectrum channel choices and warns when pair view is dormant", () => {
    const available = planPublicPanelControlPatch(
      "spectrum",
      DEFAULT_PANEL_CONTROLS,
      { channel: { type: "single", ch: 2 }, view: "ms" },
      { channelCount: 6 }
    );
    expect(available.issues).toEqual([]);
    expect(available.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "controls.view",
        inactiveReason: "singleChannel",
      },
    ]);

    const unavailable = planPublicPanelControlPatch(
      "spectrum",
      DEFAULT_PANEL_CONTROLS,
      { channel: { type: "single", ch: 2 } },
      { channelCount: 4 }
    );
    expect(unavailable.issues).toEqual([
      expect.objectContaining({ code: "controlUnavailable", path: "$.channel" }),
    ]);
    expect(unavailable.changed).toEqual([]);
  });
});
