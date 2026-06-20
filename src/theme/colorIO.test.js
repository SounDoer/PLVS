import { describe, it, expect } from "vitest";
import { toEditable, fromEditable } from "./colorIO.js";

describe("colorIO", () => {
  it("parses hex", () => {
    expect(toEditable("#fb923c")).toEqual({ hex: "#fb923c", alpha: 1 });
  });
  it("parses rgba", () => {
    expect(toEditable("rgba(255,255,255,0.04)")).toEqual({ hex: "#ffffff", alpha: 0.04 });
  });
  it("parses oklch (incl alpha)", () => {
    const e = toEditable("oklch(1 0 0 / 9%)");
    expect(e.hex.toLowerCase()).toBe("#ffffff");
    expect(e.alpha).toBeCloseTo(0.09, 2);
  });
  it("round-trips: opaque -> hex, translucent -> rgba", () => {
    expect(fromEditable("#fb923c", 1)).toBe("#fb923c");
    expect(fromEditable("#ffffff", 0.04)).toBe("rgba(255, 255, 255, 0.04)");
  });
  it("falls back to a safe default for unparseable input", () => {
    expect(toEditable("nonsense").hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
