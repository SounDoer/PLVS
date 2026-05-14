import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

const sizes = UI_PREFERENCES.typography.sizesPx;

describe("typography size scale", () => {
  it("App Title is 16px", () => expect(sizes.title).toBe(16));
  it("Panel Title is 12px (unchanged)", () => expect(sizes.section).toBe(12));
  it("Axis token source (axisUnit) is 11px", () => expect(sizes.axisUnit).toBe(11));
  it("Dynamic Display source (extraValue) is 13px (unchanged)", () =>
    expect(sizes.extraValue).toBe(13));
  it("Metric Annotation (metricMeta) is 12px", () => expect(sizes.metricMeta).toBe(12));
  it("Metric Value (metricValue) is 20px", () => expect(sizes.metricValue).toBe(20));
  it("Controls (action) is 14px (unchanged)", () => expect(sizes.action).toBe(14));
  it("Status is 11px", () => expect(sizes.status).toBe(11));
});
