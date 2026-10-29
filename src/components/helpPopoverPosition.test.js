import { describe, expect, it } from "vitest";
import { helpPopoverPlacement } from "./helpPopoverPosition.js";

const place = (rect, width, height, viewport = { width: 1152, height: 666 }) =>
  helpPopoverPlacement(rect, width, height, viewport, 8, 4);

describe("help viewport placement", () => {
  it("places short help below the header when it fits", () => {
    expect(place({ left: 870, right: 891, top: 40, bottom: 64 }, 336, 100)).toEqual({
      left: 555,
      top: 68,
      maxHeight: 650,
    });
  });
  it("places help above a low header when it fits there", () => {
    expect(place({ left: 870, right: 891, top: 500, bottom: 524 }, 336, 200)).toEqual({
      left: 555,
      top: 296,
      maxHeight: 650,
    });
  });
  it("uses full window height alongside a central header without hiding the pin trigger", () => {
    const rect = { left: 870, right: 891, top: 338, bottom: 362 };
    const result = place(rect, 336, 535);
    expect(result.left + 336).toBeLessThan(rect.left);
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top + 535).toBeLessThanOrEqual(658);
  });
  it("can place a tall reference to the right of a left-edge trigger", () => {
    const rect = { left: 30, right: 51, top: 338, bottom: 362 };
    expect(place(rect, 336, 1200)).toEqual({ left: 55, top: 8, maxHeight: 650 });
  });
  it("uses the larger vertical side in a narrow window while keeping the button clickable", () => {
    const rect = { left: 210, right: 231, top: 165, bottom: 189 };
    const result = place(rect, 304, 1200, { width: 320, height: 300 });
    expect(result).toEqual({ left: 8, top: 8, maxHeight: 153 });
    expect(result.top + result.maxHeight).toBeLessThan(rect.top);
  });
});
