import { describe, expect, it } from "vitest";
import { axisLabelCenterPx, tickOpacityNearMarker } from "./axisMarkerFade.js";

describe("axisLabelCenterPx", () => {
  it("centres a middle label on its fraction of the track", () => {
    expect(axisLabelCenterPx("middle", 0.25, 400, 12)).toBe(100);
  });

  it("puts edge-tucked labels half their height inside the edge", () => {
    expect(axisLabelCenterPx("start", 0, 400, 12)).toBe(6);
    expect(axisLabelCenterPx("end", 1, 400, 14)).toBe(393);
  });
});

describe("tickOpacityNearMarker", () => {
  it("hides a tick the marker overlaps", () => {
    expect(tickOpacityNearMarker(80, 12, 76, 14)).toBe(0);
  });

  it("hides a tick whose box exactly touches the marker", () => {
    expect(tickOpacityNearMarker(113, 12, 100, 14)).toBe(0);
  });

  it("fades in linearly across one tick height of clearance", () => {
    expect(tickOpacityNearMarker(116, 12, 100, 14)).toBe(0.25);
    expect(tickOpacityNearMarker(84, 12, 100, 14)).toBe(0.25);
    expect(tickOpacityNearMarker(119, 12, 100, 14)).toBe(0.5);
  });

  it("leaves a tick at full opacity once it clears the marker by a tick height", () => {
    expect(tickOpacityNearMarker(125, 12, 100, 14)).toBe(1);
    expect(tickOpacityNearMarker(300, 12, 100, 14)).toBe(1);
  });

  it("changes continuously as the marker moves, so a drifting reading never toggles a tick", () => {
    const steps = Array.from({ length: 41 }, (_, i) => tickOpacityNearMarker(100, 12, 80 + i, 14));
    for (let i = 1; i < steps.length; i += 1) {
      expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThanOrEqual(1 / 12 + 1e-9);
    }
  });
});
