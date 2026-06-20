import { describe, it, expect } from "vitest";
import { clampPanelPos } from "./dragClamp.js";

describe("clampPanelPos", () => {
  const win = { w: 1000, h: 800 };
  const panel = { w: 320, h: 400 };
  it("keeps a fully-inside position unchanged", () => {
    expect(clampPanelPos({ x: 100, y: 100 }, panel, win)).toEqual({ x: 100, y: 100 });
  });
  it("clamps past the right/bottom edges", () => {
    expect(clampPanelPos({ x: 900, y: 700 }, panel, win)).toEqual({ x: 680, y: 400 });
  });
  it("clamps negative to zero", () => {
    expect(clampPanelPos({ x: -50, y: -10 }, panel, win)).toEqual({ x: 0, y: 0 });
  });
});
