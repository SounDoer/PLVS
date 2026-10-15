import { describe, expect, it } from "vitest";
import { PANEL_ORIENTATIONS, orientationPointer, panelOrientation } from "./panelOrientation.js";

describe("panel orientation", () => {
  it.each([
    ["left-to-right", "x", 1],
    ["right-to-left", "x", -1],
    ["top-to-bottom", "y", 1],
    ["bottom-to-top", "y", -1],
  ])("moves an aging sample in the named direction: %s", (direction, axis, sign) => {
    const geometry = panelOrientation(direction);
    const before = geometry.toScreen(0.8, 0.5);
    const after = geometry.toScreen(0.7, 0.5);
    expect(Math.sign(after[axis] - before[axis])).toBe(sign);
  });

  it.each([
    ["right-to-left", { x: 0, y: 1 }, { x: 1, y: 0 }, "right", 800],
    ["left-to-right", { x: 1, y: 1 }, { x: 0, y: 0 }, "left", 800],
    ["bottom-to-top", { x: 0, y: 0 }, { x: 1, y: 1 }, "bottom", 200],
    ["top-to-bottom", { x: 0, y: 1 }, { x: 1, y: 0 }, "top", 200],
  ])("maps chronological and value endpoints for %s", (direction, start, end, newest, extent) => {
    const geometry = panelOrientation(direction);
    expect(geometry.toScreen(0, 0)).toEqual(start);
    expect(geometry.toScreen(1, 1)).toEqual(end);
    expect(geometry.newestEdge).toBe(newest);
    expect(geometry.timeExtent({ width: 800, height: 200 })).toBe(extent);
  });

  it.each(PANEL_ORIENTATIONS)(
    "round trips a pointer in a non-square offset plot: %s",
    (direction) => {
      const geometry = panelOrientation(direction);
      const point = geometry.toScreen(0.25, 0.75);
      expect(
        orientationPointer(direction, 30 + point.x * 800, 50 + point.y * 200, {
          left: 30,
          top: 50,
          width: 800,
          height: 200,
        })
      ).toEqual({ time: 0.25, value: 0.75 });
    }
  );

  it.each(PANEL_ORIENTATIONS)("keeps zero-size pointer geometry finite: %s", (direction) => {
    const result = orientationPointer(direction, 0, 0, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(result.time)).toBe(true);
    expect(Number.isFinite(result.value)).toBe(true);
  });
});
