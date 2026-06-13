import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

const sizes = UI_PREFERENCES.typography.sizesPx;
const splitters = UI_PREFERENCES.layout.splitters;

describe("typography size scale", () => {
  it("App Title is 16px", () => expect(sizes.title).toBe(16));
  it("Panel Title is 12px (unchanged)", () => expect(sizes.section).toBe(12));
  it("Axis token source (axisUnit) is 11px", () => expect(sizes.axisUnit).toBe(11));
  it("Dynamic Display source (extraValue) is 13px (unchanged)", () =>
    expect(sizes.extraValue).toBe(13));
  it("Metric Annotation (metricMeta) is 12px", () => expect(sizes.metricMeta).toBe(12));
  it("Metric Value (metricValue) is 18px", () => expect(sizes.metricValue).toBe(18));
  it("Controls (action) is 14px (unchanged)", () => expect(sizes.action).toBe(14));
  it("Status is 11px", () => expect(sizes.status).toBe(11));
});

describe("spacing data", () => {
  it("sectionGapRem is 0.55 (unified with shell-gap)", () =>
    expect(splitters.sectionGapRem).toBe(0.55));
  it("sectionGapPx is removed", () => expect(splitters).not.toHaveProperty("sectionGapPx"));
});
