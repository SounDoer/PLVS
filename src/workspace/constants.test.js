import { describe, it, expect } from "vitest";
import { DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";

describe("digit keyboard shortcuts (keys 1–N map to ALL_MODULE_IDS)", () => {
  it("covers all modules: one digit key per module", () => {
    expect(ALL_MODULE_IDS).toHaveLength(7);
  });

  it("digit 7 maps to waveform", () => {
    expect(ALL_MODULE_IDS[6]).toBe("waveform");
  });
});

describe("workspace state shape", () => {
  it("DEFAULT_WORKSPACE_STATE has the lean persisted shape", () => {
    expect(Object.keys(DEFAULT_WORKSPACE_STATE).sort()).toEqual(
      ["fullscreenId", "panelControls", "tree", "visibleModules"].sort()
    );
  });
});

describe("visual history panel minimum heights", () => {
  it("uses a shared 160px minimum for stacked chart panels", () => {
    expect(MODULE_REGISTRY.loudness.minHeight).toBe(160);
    expect(MODULE_REGISTRY.spectrum.minHeight).toBe(160);
    expect(MODULE_REGISTRY.spectrogram.minHeight).toBe(160);
    expect(MODULE_REGISTRY.waveform.minHeight).toBe(160);
  });
});
