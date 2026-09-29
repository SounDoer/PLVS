import { describe, expect, it } from "vitest";

import { hairlineDevicePx, snapHairline } from "./deviceHairline.js";

describe("hairlineDevicePx", () => {
  it("floors to whole device pixels with a minimum of one, as Chromium does for CSS borders", () => {
    expect([1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(hairlineDevicePx)).toEqual([1, 1, 1, 1, 2, 2, 3]);
  });

  it("does not lose a pixel to a ratio that is a hair under a whole number", () => {
    expect(hairlineDevicePx(1.9999999)).toBe(2);
  });

  it("never returns zero for a ratio below one", () => {
    expect(hairlineDevicePx(0.8)).toBe(1);
  });
});

describe("snapHairline", () => {
  it("centres an odd-width line on a pixel centre", () => {
    expect(snapHairline(10.3, 1)).toBe(10.5);
    expect(snapHairline(10.9, 1)).toBe(10.5);
  });

  it("centres an even-width line on a pixel boundary", () => {
    expect(snapHairline(10.3, 2)).toBe(10);
    expect(snapHairline(10.8, 2)).toBe(11);
  });
});
