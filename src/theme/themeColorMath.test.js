import { describe, expect, it } from "vitest";

import { isOpaqueHexColor, normalizeOpaqueColor } from "./themeColorMath.js";

describe("normalizeOpaqueColor", () => {
  it.each([
    [" #AbC ", "#aabbcc"],
    ["#FB923C", "#fb923c"],
    ["rgb(251, 146, 60)", "#fb923c"],
    ["rgb(100% 0% 0%)", "#ff0000"],
    ["oklch(100% 0 0)", "#ffffff"],
    ["oklch(0 0 270deg)", "#000000"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeOpaqueColor(input)).toBe(expected);
  });

  it.each([
    null,
    "",
    "#abcd",
    "#11223344",
    "rgba(1, 2, 3, 1)",
    "rgb(1 2 3 / 1)",
    "oklch(0.5 0.2 20 / 1)",
    "rgb(256, 0, 0)",
    "rgb(1x, 2, 3)",
    "rgb(1, 2 3)",
    "oklch(1.1 0 0)",
    "oklch(0.5x 0.2 20)",
  ])("rejects non-opaque or invalid input %s", (input) => {
    expect(normalizeOpaqueColor(input)).toBeNull();
  });
});

describe("isOpaqueHexColor", () => {
  it("accepts only canonical lowercase hex", () => {
    expect(isOpaqueHexColor("#aabbcc")).toBe(true);
    expect(isOpaqueHexColor("#AABBCC")).toBe(false);
    expect(isOpaqueHexColor("#abc")).toBe(false);
  });
});
