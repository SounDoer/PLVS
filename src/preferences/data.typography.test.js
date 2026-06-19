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
});
