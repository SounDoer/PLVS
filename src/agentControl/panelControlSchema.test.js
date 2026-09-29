import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";

describe("buildPublicPanelControlSchema", () => {
  it("describes Bar Colors and when each threshold pair is effective", () => {
    const byDefault = buildPublicPanelControlSchema("levelMeter", DEFAULT_PANEL_CONTROLS);
    expect(byDefault.properties.peakBarColors).toMatchObject({
      effective: true,
      default: "gradient",
      options: ["gradient", "levelZones"],
    });
    expect(byDefault.properties.rmsBarColors).toMatchObject({
      effective: false,
      inactiveReason: "nonRmsMode",
    });
    expect(byDefault.properties.peakThresholdsDbfs).toMatchObject({
      effective: false,
      inactiveReason: "gradientBarColors",
      default: { warning: -6, critical: -1 },
      constraints: [{ kind: "ordered", lower: "warning", upper: "critical", inclusive: true }],
    });

    const zones = buildPublicPanelControlSchema("levelMeter", {
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterPeakBarColors: "levelZones",
    });
    expect(zones.properties.peakThresholdsDbfs.effective).toBe(true);
    expect(zones.properties.rmsThresholdsDbfs).toMatchObject({
      effective: false,
      inactiveReason: "nonRmsMode",
    });
  });

  it("describes Level Meter ranges and current mode-dependent effectiveness", () => {
    const schema = buildPublicPanelControlSchema("levelMeter", DEFAULT_PANEL_CONTROLS);

    expect(schema).toMatchObject({
      type: "object",
      patchMode: "merge",
      properties: {
        mode: {
          type: "string",
          default: "peak",
          options: ["peak", "rms", "momentary", "shortTerm"],
        },
        playbackMax: { type: "boolean", effective: false, inactiveReason: "peakMode" },
        floatingValue: { effective: false, inactiveReason: "nonLoudnessMode" },
        tpMaxMarker: { effective: true },
        levelRangeDbfs: {
          type: "object",
          patchMode: "replace",
          unit: "dBFS",
          constraints: expect.arrayContaining([{ kind: "minimumSpan", value: 12 }]),
        },
        loudnessRangeLufs: { effective: false, inactiveReason: "levelMode" },
      },
    });
  });

  it("removes the unavailable Loudness reference option", () => {
    const withoutReference = buildPublicPanelControlSchema("loudness", DEFAULT_PANEL_CONTROLS, {
      hasLoudnessReference: false,
    });
    const withReference = buildPublicPanelControlSchema("loudness", DEFAULT_PANEL_CONTROLS, {
      hasLoudnessReference: true,
    });

    expect(withoutReference.properties.layers).toMatchObject({
      type: "array",
      patchMode: "replace",
      options: ["momentary", "shortTerm"],
      default: ["momentary", "shortTerm"],
    });
    expect(withReference.properties.layers.options).toEqual([
      "momentary",
      "shortTerm",
      "reference",
    ]);
  });

  it("reports assumed and detected channel topology with object-valued choices", () => {
    const assumed = buildPublicPanelControlSchema("spectrum", DEFAULT_PANEL_CONTROLS);
    const detected = buildPublicPanelControlSchema("spectrum", DEFAULT_PANEL_CONTROLS, {
      channelCount: 6,
      channelLabels: ["L", "R", "C", "LFE", "Ls", "Rs"],
    });

    expect(assumed.channelTopology).toEqual({ status: "assumed", channelCount: 2 });
    expect(assumed.properties.channel.options).toEqual([
      { title: "Ch 1+Ch 2", value: { type: "pair", x: 0, y: 1 } },
    ]);
    expect(detected.channelTopology).toEqual({ status: "detected", channelCount: 6 });
    expect(detected.properties.channel.options).toContainEqual({
      title: "C",
      value: { type: "single", ch: 2 },
    });
  });

  it("describes Polar Sample Persistence and its mode-dependent effectiveness", () => {
    const inactive = buildPublicPanelControlSchema("vectorscope", DEFAULT_PANEL_CONTROLS);
    expect(inactive.properties.persistenceMs).toMatchObject({
      type: "integer",
      title: "Persistence",
      unit: "ms",
      default: 400,
      minimum: 0,
      maximum: 1000,
      effective: false,
      inactiveReason: "nonPolarSampleMode",
    });

    const active = buildPublicPanelControlSchema("vectorscope", {
      ...DEFAULT_PANEL_CONTROLS,
      vectorscopeMode: "polarSample",
    });
    expect(active.properties.persistenceMs).toMatchObject({ effective: true });
  });

  it("describes Stereo Map Energy Fade Strength as a bounded display percentage", () => {
    const schema = buildPublicPanelControlSchema("stereo-map", DEFAULT_PANEL_CONTROLS);

    expect(schema.properties.energyFadePercent).toMatchObject({
      type: "integer",
      title: "Energy Fade Strength",
      unit: "%",
      default: 75,
      minimum: 0,
      maximum: 100,
      effective: true,
    });
    expect(schema.properties.colorBlendPercent).toMatchObject({
      type: "integer",
      title: "Color Blend",
      unit: "%",
      default: 50,
      minimum: 0,
      maximum: 100,
      effective: true,
    });

    const correlation = buildPublicPanelControlSchema("stereo-map", {
      ...DEFAULT_PANEL_CONTROLS,
      stereoMapMode: "correlation",
    });
    expect(correlation.properties.colorBlendPercent).toMatchObject({
      effective: false,
      inactiveReason: "nonPositionMode",
    });
  });

  it("exposes optional Grid controls with Stereo Map mode-local effectiveness", () => {
    expect(
      buildPublicPanelControlSchema("loudness", DEFAULT_PANEL_CONTROLS).properties.grid
    ).toMatchObject({
      type: "boolean",
      default: false,
      effective: true,
    });
    expect(
      buildPublicPanelControlSchema("spectrum", DEFAULT_PANEL_CONTROLS).properties.grid
    ).toMatchObject({
      type: "boolean",
      default: false,
      effective: true,
    });

    const stereoMap = buildPublicPanelControlSchema("stereo-map", DEFAULT_PANEL_CONTROLS);
    expect(stereoMap.properties.grid).toMatchObject({
      type: "object",
      patchMode: "merge",
      properties: {
        position: { default: false, effective: true },
        correlation: { default: false, effective: false, inactiveReason: "nonCorrelationMode" },
        monoLossDb: { default: false, effective: false, inactiveReason: "nonMonoLossMode" },
        msRatioDb: { default: false, effective: false, inactiveReason: "nonMsRatioMode" },
      },
    });
  });

  it("describes mergeable nested controls and their dormant state", () => {
    const spectrogram = buildPublicPanelControlSchema("spectrogram", DEFAULT_PANEL_CONTROLS);
    const stats = buildPublicPanelControlSchema("stats", DEFAULT_PANEL_CONTROLS);

    expect(spectrogram.properties.threeD).toMatchObject({
      type: "object",
      patchMode: "merge",
      effective: false,
      inactiveReason: "heatmapMode",
      properties: {
        azimuthDeg: { minimum: 0, exclusiveMaximum: 360 },
        elevationDeg: { minimum: 5, maximum: 85 },
      },
    });
    expect(stats.properties.metrics).toMatchObject({
      type: "object",
      patchMode: "merge",
      properties: {
        visible: { type: "array", patchMode: "replace", uniqueItems: true },
        order: {
          type: "array",
          patchMode: "replace",
          constraints: [{ kind: "fullPermutation" }],
        },
      },
    });
  });
});
