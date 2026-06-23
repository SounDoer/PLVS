import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

const sizes = UI_PREFERENCES.typography.sizesPx;

describe("typography size scale", () => {
  it("App Title is 16px", () => expect(sizes.title).toBe(16));
  it("Axis token source (axisUnit) is 11px", () => expect(sizes.axisUnit).toBe(11));
  it("Dynamic Display source (extraValue) is 13px (unchanged)", () =>
    expect(sizes.extraValue).toBe(13));
  it("Metric Annotation (metricMeta) is 12px", () => expect(sizes.metricMeta).toBe(12));
  it("Metric Value (metricValue) is 18px", () => expect(sizes.metricValue).toBe(18));
  it("Status is 11px", () => expect(sizes.status).toBe(11));
});

describe("spacing data", () => {
  it("legacy panel section gap fields are removed", () => {
    expect(UI_PREFERENCES.layout.splitters).not.toHaveProperty("sectionGapPx");
    expect(UI_PREFERENCES.layout.splitters).not.toHaveProperty("sectionGapRem");
  });

  it("uses compact default panel padding", () => {
    expect(UI_PREFERENCES.layout.articlePadding).toMatchObject({
      defaultXRem: 0.5,
      defaultYRem: 0.35,
      metricsRem: 0,
    });
  });

  it("uses compact vertical chart insets", () => {
    expect(UI_PREFERENCES.layout.spacingRem).toMatchObject({
      chartInsetTop: 0.2,
      chartInsetBottom: 0,
    });
  });

  it("keeps one shared chart axis gap and no retired display padding aliases", () => {
    const spacing = UI_PREFERENCES.layout.spacingRem;

    expect(spacing).toHaveProperty("chartAxisGap");
    expect(spacing).not.toHaveProperty("axisGapX");
    expect(spacing).not.toHaveProperty("axisGapY");
    expect(spacing).not.toHaveProperty("peakDisplayTopInset");
    expect(spacing).not.toHaveProperty("peakDisplayBottomInset");
    expect(spacing).not.toHaveProperty("historyDisplayTopInset");
    expect(spacing).not.toHaveProperty("historyDisplayBottomInset");
    expect(spacing).not.toHaveProperty("spectrumDisplayTopInset");
    expect(spacing).not.toHaveProperty("spectrumDisplayBottomInset");
    expect(spacing).toHaveProperty("chartInsetTop");
    expect(spacing).toHaveProperty("chartInsetBottom");
    expect(spacing).not.toHaveProperty("historySvgPad");
    expect(spacing).not.toHaveProperty("spectrumSvgPad");
    expect(spacing).not.toHaveProperty("chartPad");
    expect(spacing).toHaveProperty("vectorOuterInset");
    expect(spacing).not.toHaveProperty("chartOuterInset");
  });

  it("uses one axis rail width source for chart Y axes", () => {
    expect(UI_PREFERENCES.layout.widthsPx).toEqual({ axisRail: 24 });
  });
});
