import { describe, expect, it } from "vitest";
import { fitChartHud } from "./chartHudLayout.js";

describe("hover HUD space fitting", () => {
  it("uses a vertical list when every field fits", () => {
    expect(fitChartHud([70, 110, 110], 250, 100, 20)).toEqual({
      horizontal: false,
      count: 3,
      overflow: null,
    });
  });
  it("uses one horizontal row in a short wide panel", () => {
    expect(fitChartHud([70, 110, 110], 340, 35, 20)).toEqual({
      horizontal: true,
      count: 3,
      overflow: null,
    });
  });
  it("wraps complete fields into two rows before omitting any", () => {
    expect(fitChartHud([70, 110, 110], 220, 55, 20)).toEqual({
      horizontal: true,
      count: 3,
      overflow: null,
    });
  });
  it("reserves space for an ellipsis and drops lower-priority fields first", () => {
    expect(fitChartHud([70, 110, 110, 80], 220, 35, 20)).toEqual({
      horizontal: true,
      count: 1,
      overflow: "…",
    });
  });
  it("counts omitted channels without counting the time field", () => {
    expect(fitChartHud([70, 110, 110, 110, 110], 260, 55, 20, true)).toEqual({
      horizontal: true,
      count: 3,
      overflow: "+2 ch",
    });
  });
});
