import { describe, it, expect } from "vitest";
import { samplePeakLineColor } from "./colorMath";

const cfg = { top: "#ff0000", mid: "#ffff00", bottom: "#00ff00", midStopPercent: 50 };

describe("samplePeakLineColor", () => {
  it("returns fallback for non-finite dB", () => {
    expect(samplePeakLineColor(-Infinity, () => 0, cfg)).toBe("var(--ui-signal-peak-sample)");
    expect(samplePeakLineColor(NaN, () => 0, cfg)).toBe("var(--ui-signal-peak-sample)");
  });
  it("returns fallback for invalid hex colors in config", () => {
    const badCfg = { top: "red", mid: "blue", bottom: "green", midStopPercent: 50 };
    expect(samplePeakLineColor(-10, () => 0.5, badCfg)).toBe("var(--ui-signal-peak-sample)");
  });
  it("returns an rgb() string for valid inputs", () => {
    const result = samplePeakLineColor(-10, () => 0.5, cfg);
    expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
  it("at t=0 (top of meter) returns the top color", () => {
    expect(samplePeakLineColor(0, () => 0, cfg)).toBe("rgb(255, 0, 0)");
  });
  it("at t=1 (bottom of meter) returns the bottom color", () => {
    expect(samplePeakLineColor(0, () => 1, cfg)).toBe("rgb(0, 255, 0)");
  });
  it("at t=midStop returns the mid color", () => {
    expect(samplePeakLineColor(0, () => 0.5, cfg)).toBe("rgb(255, 255, 0)");
  });
  it("accepts shorthand 3-digit hex colors", () => {
    const shortCfg = { top: "#f00", mid: "#ff0", bottom: "#0f0", midStopPercent: 50 };
    expect(samplePeakLineColor(0, () => 0, shortCfg)).toBe("rgb(255, 0, 0)");
  });
});
