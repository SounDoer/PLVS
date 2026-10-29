import { describe, expect, it } from "vitest";
import { positionTourCard, tourStepContent } from "./quickTourModel.js";

const state = {
  running: false,
  snapshot: false,
  hasHistory: true,
  dockSupported: true,
  applicationsSupported: true,
};

describe("tour content follows observable state", () => {
  it("does not require restarting an active measurement or leaving a Snapshot", () => {
    expect(tourStepContent(0, { ...state, running: true }).body).toContain("Metering is running");
    expect(tourStepContent(0, { ...state, running: true, snapshot: true }).body).toContain(
      "Return to Live"
    );
    expect(tourStepContent(7, { ...state, snapshot: true })).toMatchObject({ target: "transport" });
    expect(tourStepContent(7, state).target).toBe("history");
    expect(tourStepContent(7, { ...state, hasHistory: false }).body).toContain("continue");
  });

  it("only describes platform-supported controls", () => {
    expect(tourStepContent(4, { ...state, dockSupported: false }).body).not.toContain("Dock");
    expect(tourStepContent(1, { ...state, applicationsSupported: false }).body).not.toContain(
      "application"
    );
  });
});

describe("tour positioning", () => {
  const viewport = { width: 900, height: 600 };
  const card = { width: 300, height: 180 };

  it("stays within the viewport when a toolbar control is near the right edge", () => {
    const target = { left: 860, right: 890, top: 10, bottom: 40 };
    const result = positionTourCard(target, card, viewport);
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + card.width).toBeLessThanOrEqual(892);
    expect(result.top).toBeGreaterThanOrEqual(target.bottom);
  });

  it("moves above a control near the bottom instead of covering it", () => {
    const target = { left: 10, right: 40, top: 560, bottom: 590 };
    const result = positionTourCard(target, card, viewport);
    expect(result.top + card.height).toBeLessThan(target.top);
  });

  it("provides an in-viewport fallback without a target", () => {
    const result = positionTourCard(null, card, viewport);
    expect(result.left + card.width).toBeLessThanOrEqual(892);
    expect(result.top).toBe(8);
  });
});
