import { describe, expect, it } from "vitest";
import { AUDIOMETER_SEMANTIC_DARK, AUDIOMETER_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";
import { buildMeterColorBridge } from "./meterColorBridge.js";

describe("buildMeterColorBridge", () => {
  it("maps dark semantic tokens to legacy ui-color fields", () => {
    const b = buildMeterColorBridge(AUDIOMETER_SEMANTIC_DARK, "dark");
    expect(b.pageBg).toBe(AUDIOMETER_SEMANTIC_DARK.background);
    expect(b.insetBg).toBe(AUDIOMETER_SEMANTIC_DARK.muted);
    expect(b.brand).toBe(AUDIOMETER_SEMANTIC_DARK.primary);
    expect(b.correlation.bad).toBe(AUDIOMETER_SEMANTIC_DARK.destructive);
  });

  it("maps light semantic tokens to legacy ui-color fields", () => {
    const b = buildMeterColorBridge(AUDIOMETER_SEMANTIC_LIGHT, "light");
    expect(b.pageBg).toBe(AUDIOMETER_SEMANTIC_LIGHT.background);
    expect(b.panelBg).toBe(AUDIOMETER_SEMANTIC_LIGHT.card);
  });
});
