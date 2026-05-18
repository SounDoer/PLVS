import { describe, expect, it } from "vitest";
import { PLVS_SEMANTIC_DARK } from "./shadcnSemanticPreset.js";
import { buildMeterColorBridge } from "./meterColorBridge.js";

describe("buildMeterColorBridge", () => {
  it("returns orange-based signal colors", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b.peakSamplePeak).toBe("#fb923c");
    expect(b.peakTruePeak).toBe("#f97373");
    expect(b.tpMaxText).toBe("#f97373");
  });

  it("returns orange-based correlation colors", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b.correlation.good).toBe("#34d399");
    expect(b.correlation.mid).toBe("#9e9488");
    expect(b.correlation.bad).toBe("#f97373");
  });

  it("returns new metric row token keys", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b).toHaveProperty("metricRowBg");
    expect(b).toHaveProperty("metricRowHoverBg");
    expect(b).toHaveProperty("metricRowToggleOnBorder");
    expect(b).toHaveProperty("metricRowToggleOnBg");
    expect(b).toHaveProperty("metricRowToggleOnGlow");
    expect(b).toHaveProperty("metricToggleOnLabel");
    expect(b).toHaveProperty("loudnessTargetLine");
  });

  it("does not return retired keys", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b).not.toHaveProperty("insetDark");
    expect(b).not.toHaveProperty("settingsOverlay");
    expect(b).not.toHaveProperty("targetValue");
    expect(b).not.toHaveProperty("metricToggleOnUnitText");
    expect(b).not.toHaveProperty("metricToggleOnLabelText");
  });

  it("metricToggleOnLabel is orange brand color", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b.metricToggleOnLabel).toBe("#fb923c");
  });

  it("loudnessTargetLine is semi-transparent orange", () => {
    const b = buildMeterColorBridge(PLVS_SEMANTIC_DARK, "dark");
    expect(b.loudnessTargetLine).toBe("rgba(251,146,60,0.4)");
  });
});
