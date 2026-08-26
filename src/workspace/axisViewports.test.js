import { describe, expect, it } from "vitest";
import {
  AXIS_VIEWPORTS,
  axisKindsForModule,
  localRangeKeys,
  normalizeAxisViewport,
  readLocalRange,
  writeLocalRange,
} from "./axisViewports";
import { MODULE_CATALOG } from "./moduleCatalog";
import { FREQUENCY_VIEWPORT } from "../math/axisInteractionMath";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls";

describe("axis viewport descriptors", () => {
  it("names only modules that exist", () => {
    for (const kind of Object.values(AXIS_VIEWPORTS)) {
      for (const moduleId of Object.keys(kind.members)) {
        expect(MODULE_CATALOG[moduleId]).toBeTruthy();
      }
    }
  });

  it("names only panel control keys that exist", () => {
    const controls = normalizePanelControls(DEFAULT_PANEL_CONTROLS);
    for (const kind of Object.values(AXIS_VIEWPORTS)) {
      for (const { minKey, maxKey } of Object.values(kind.members)) {
        expect(controls).toHaveProperty(minKey);
        expect(controls).toHaveProperty(maxKey);
      }
    }
  });

  it("takes the frequency bounds from the axis the panels already share", () => {
    expect(AXIS_VIEWPORTS.frequency.absMin).toBe(FREQUENCY_VIEWPORT.absMin);
    expect(AXIS_VIEWPORTS.frequency.absMax).toBe(FREQUENCY_VIEWPORT.absMax);
    expect(AXIS_VIEWPORTS.frequency.minSpan).toBe(FREQUENCY_VIEWPORT.minSpan);
  });

  it("groups the three frequency panels by quantity, not by orientation", () => {
    // Spectrogram's frequency axis is vertical and belongs to the group regardless.
    expect(Object.keys(AXIS_VIEWPORTS.frequency.members).sort()).toEqual([
      "spectrogram",
      "spectrum",
      "stereo-map",
    ]);
  });
});

describe("axisKindsForModule", () => {
  it("reports the kinds a module takes part in", () => {
    expect(axisKindsForModule("spectrum")).toEqual(["frequency"]);
    expect(axisKindsForModule("spectrogram")).toEqual(["frequency"]);
  });

  it("reports nothing for a module with no linkable axis", () => {
    expect(axisKindsForModule("levelMeter")).toEqual([]);
    expect(axisKindsForModule("nonsense")).toEqual([]);
  });
});

describe("normalizeAxisViewport", () => {
  it("supplies the full range for a missing value", () => {
    expect(normalizeAxisViewport("frequency", undefined)).toEqual({ min: 20, max: 20000 });
  });

  it("keeps a valid custom range", () => {
    expect(normalizeAxisViewport("frequency", { min: 200, max: 5000 })).toEqual({
      min: 200,
      max: 5000,
    });
  });

  it("clamps to the absolute bounds", () => {
    expect(normalizeAxisViewport("frequency", { min: 1, max: 90000 })).toEqual({
      min: 20,
      max: 20000,
    });
  });

  it("opens a range narrower than the minimum span", () => {
    const opened = normalizeAxisViewport("frequency", { min: 1000, max: 1010 });

    expect(Math.log2(opened.max / opened.min)).toBeGreaterThanOrEqual(1);
  });

  it("repairs garbage without throwing", () => {
    expect(normalizeAxisViewport("frequency", { min: "x", max: null })).toEqual({
      min: 20,
      max: 20000,
    });
  });

  it("agrees with the normalization the local panel control already gets", () => {
    // The shared value and the dormant local one must not drift; both go through one repair.
    const local = normalizePanelControls({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumXMinFreq: 1000,
      spectrumXMaxFreq: 1010,
    });
    const shared = normalizeAxisViewport("frequency", { min: 1000, max: 1010 });

    expect(shared).toEqual({ min: local.spectrumXMinFreq, max: local.spectrumXMaxFreq });
  });
});

describe("local range access", () => {
  it("maps each member to its own pair of control keys", () => {
    expect(localRangeKeys("frequency", "spectrum")).toEqual({
      minKey: "spectrumXMinFreq",
      maxKey: "spectrumXMaxFreq",
    });
    expect(localRangeKeys("frequency", "spectrogram")).toEqual({
      minKey: "spectrogramYMinFreq",
      maxKey: "spectrogramYMaxFreq",
    });
    expect(localRangeKeys("frequency", "levelMeter")).toBeNull();
  });

  it("reads a member's dormant local range", () => {
    const controls = normalizePanelControls({
      ...DEFAULT_PANEL_CONTROLS,
      stereoMapXMinFreq: 200,
      stereoMapXMaxFreq: 5000,
    });

    expect(readLocalRange("frequency", "stereo-map", controls)).toEqual({ min: 200, max: 5000 });
  });

  it("writes a member's local range under its own keys", () => {
    expect(writeLocalRange("frequency", "spectrogram", { min: 200, max: 5000 })).toEqual({
      spectrogramYMinFreq: 200,
      spectrogramYMaxFreq: 5000,
    });
  });

  it("reads and writes nothing for a module outside the kind", () => {
    expect(readLocalRange("frequency", "waveform", DEFAULT_PANEL_CONTROLS)).toBeNull();
    expect(writeLocalRange("frequency", "waveform", { min: 200, max: 5000 })).toEqual({});
  });
});
