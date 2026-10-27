import { describe, expect, it } from "vitest";
import { chartHudSide, fitChartHud } from "./chartHudLayout.js";

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

describe("hover HUD corner", () => {
  // A 120 x 60 HUD in a 600-wide boundary: left corner at x 40, right corner ends at x 596.
  const hud = { left: 40, right: 4, top: 4, width: 120, height: 60, boundaryWidth: 600 };

  it("stays in the left corner while the cursor is away from it", () => {
    expect(chartHudSide({ x: 300, y: 30 }, hud)).toBe("left");
    expect(chartHudSide(null, hud)).toBe("left");
  });
  it("moves to the right corner when the cursor nears the left one", () => {
    expect(chartHudSide({ x: 100, y: 30 }, hud)).toBe("right");
    expect(chartHudSide({ x: 170, y: 70 }, hud)).toBe("right");
  });
  it("returns to the left corner when the cursor nears the right one", () => {
    expect(chartHudSide({ x: 520, y: 30 }, hud)).toBe("left");
  });
  it("stays left when the right corner would cover the cursor as well", () => {
    expect(chartHudSide({ x: 100, y: 30 }, { ...hud, boundaryWidth: 200 })).toBe("left");
  });
});
