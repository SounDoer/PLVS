import { describe, expect, it } from "vitest";
import { AUDIOMETER_SEMANTIC_DARK, AUDIOMETER_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";
import { buildMeterColorBridge } from "./meterColorBridge.js";

const A_CLASS_KEYS = [
  // Direct shadcn aliases — never read by components, replaced by Tailwind utilities
  "pageBg",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "textSubtle",
  "panelBg",
  "panelBgSplitter",
  "insetBg",
  "borderDefault",
  "divider",
  "brand",
  "brandLight",
  "brandHover",
  "controlBg",
  "metricRowBorder",
  "metricRowToggleOnBorder",
  "metricLabelText",
  "metricValueText",
  "metricUnitText",
  "targetLabel",
  "legendHistOnBg",
  "legendHistOnText",
  "legendHistOffBg",
  "legendHistOffText",
  // Computed but never consumed by any component (dead code)
  "controlHoverBg",
  "settingsRowBg",
  "settingsDialogShadow",
];

describe("buildMeterColorBridge", () => {
  it("does not return shadcn-equivalent (A-class) keys", () => {
    const dark = buildMeterColorBridge(AUDIOMETER_SEMANTIC_DARK, "dark");
    const light = buildMeterColorBridge(AUDIOMETER_SEMANTIC_LIGHT, "light");
    for (const key of A_CLASS_KEYS) {
      expect(dark, `dark bridge should not contain "${key}"`).not.toHaveProperty(key);
      expect(light, `light bridge should not contain "${key}"`).not.toHaveProperty(key);
    }
  });

  it("retains B-class signal keys (no shadcn equivalent)", () => {
    const b = buildMeterColorBridge(AUDIOMETER_SEMANTIC_DARK, "dark");
    expect(b.peakSamplePeak).toBeDefined();
    expect(b.peakTruePeak).toBeDefined();
    expect(b.tpMaxText).toBeDefined();
    expect(b.correlation.bad).toBe(AUDIOMETER_SEMANTIC_DARK.destructive);
    expect(b.correlation.mid).toBeDefined();
    expect(b.correlation.good).toBeDefined();
    expect(b.loudnessTargetLine).toBeDefined();
  });

  it("retains computed keys that differ between light and dark", () => {
    const dark = buildMeterColorBridge(AUDIOMETER_SEMANTIC_DARK, "dark");
    const light = buildMeterColorBridge(AUDIOMETER_SEMANTIC_LIGHT, "light");
    expect(dark.insetDark).not.toBe(light.insetDark);
    expect(dark.metricRowBg).not.toBe(light.metricRowBg);
    expect(dark.metricRowToggleOnBg).not.toBe(light.metricRowToggleOnBg);
    expect(dark.metricToggleOnLabelText).not.toBe(light.metricToggleOnLabelText);
  });
});
