import { describe, expect, it, vi } from "vitest";

import { canvasCssScale, strokeCssWidth } from "./canvasCssScale.js";

function sizedCanvas({ width, height, clientWidth, clientHeight }) {
  return { width, height, clientWidth, clientHeight };
}

describe("canvasCssScale", () => {
  it("reads each axis from the canvas, so a capped axis keeps its own scale", () => {
    const canvas = sizedCanvas({ width: 300, height: 160, clientWidth: 300, clientHeight: 80 });
    expect(canvasCssScale(canvas)).toEqual({ x: 1, y: 2 });
  });

  it("falls back to 1 before the canvas has a CSS size", () => {
    const canvas = sizedCanvas({ width: 300, height: 150, clientWidth: 0, clientHeight: 0 });
    expect(canvasCssScale(canvas)).toEqual({ x: 1, y: 1 });
  });
});

describe("strokeCssWidth", () => {
  it("scales only the pen for the stroke and restores the identity transform", () => {
    const calls = [];
    const ctx = {
      setTransform: vi.fn((...args) => calls.push(["setTransform", ...args])),
      stroke: vi.fn(() => calls.push(["stroke"])),
    };

    strokeCssWidth(ctx, { x: 1, y: 2 });

    expect(calls).toEqual([
      ["setTransform", 1, 0, 0, 2, 0, 0],
      ["stroke"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
    ]);
  });
});
