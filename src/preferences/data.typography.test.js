import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

const sizes = UI_PREFERENCES.typography.sizesPx;

describe("typography size scale", () => {
  it("Axis token source (axisUnit) is 11px", () => expect(sizes.axisUnit).toBe(11));
  it("Dynamic Display source (extraValue) is 13px (unchanged)", () =>
    expect(sizes.extraValue).toBe(13));
  it("Metric Annotation (metricMeta) is 12px", () => expect(sizes.metricMeta).toBe(12));
  it("Metric Value (metricValue) is 16px", () => expect(sizes.metricValue).toBe(16));
  it("Status is 11px", () => expect(sizes.status).toBe(11));
});

describe("spacing data", () => {
  it("legacy panel section gap fields are removed", () => {
    expect(UI_PREFERENCES.layout.splitters).not.toHaveProperty("sectionGapPx");
    expect(UI_PREFERENCES.layout.splitters).not.toHaveProperty("sectionGapRem");
  });

  it("uses compact default panel padding", () => {
    expect(UI_PREFERENCES.layout.articlePadding).toMatchObject({
      defaultXRem: 0.25,
      defaultYRem: 0.35,
    });
    expect(UI_PREFERENCES.layout.articlePadding).not.toHaveProperty("metricsRem");
  });

  it("uses compact footer padding", () => {
    expect(UI_PREFERENCES.layout.footer).toMatchObject({
      paddingXRem: 0.5,
      paddingYRem: 0.4,
    });
  });

  it("uses tighter metric list spacing", () => {
    expect(UI_PREFERENCES.layout.spacingRem.metricsListGap).toBe(0.1);
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
    expect(UI_PREFERENCES.layout.widthsPx).toEqual({ axisRail: 20 });
  });
});

describe("metric row tuning", () => {
  it("keeps only the row dimensions still used by StatsPanel", () => {
    expect(UI_PREFERENCES.modules.stats.metrics).toMatchObject({
      valueColumnCh: 5.5,
      unitColumnRem: 2.1,
      rowMinHeightRem: 1.2,
      rowPaddingXRem: 0.25,
      rowGapRem: 0.5,
    });
    expect(UI_PREFERENCES.modules.loudness).not.toHaveProperty("metrics");
    expect(UI_PREFERENCES.modules.stats.metrics).not.toHaveProperty("rowPaddingYRem");
    expect(UI_PREFERENCES.radii).not.toHaveProperty("metricRow");
  });
});
