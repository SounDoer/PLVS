import { describe, expect, it } from "vitest";
import { applyRangeConstraints, computeLinearPan, computeLinearZoom } from "./axisInteractionMath";

// Mono Loss: a loss cannot be a gain, so the top is 0 dB and only the floor moves.
const MONO_LOSS = { absMin: -60, absMax: 0, minSpan: 6, pinnedMax: true };
// M/S Ratio: read against 0 dB, which therefore has to stay on screen.
const MS_RATIO = { absMin: -96, absMax: 48, minSpan: 6, mustInclude: 0 };

describe("applyRangeConstraints, pinned max", () => {
  it("keeps the top at the bound and lets the floor carry the change", () => {
    expect(applyRangeConstraints({ min: -30, max: -8, ...MONO_LOSS })).toEqual({
      min: -30,
      max: 0,
    });
  });

  it("holds the floor inside the bounds and off the minimum span", () => {
    expect(applyRangeConstraints({ min: -400, max: 0, ...MONO_LOSS }).min).toBe(-60);
    expect(applyRangeConstraints({ min: -1, max: 0, ...MONO_LOSS }).min).toBe(-6);
  });
});

describe("applyRangeConstraints, must include a reference", () => {
  it("passes a window that already holds the reference through untouched", () => {
    expect(applyRangeConstraints({ min: -48, max: 24, ...MS_RATIO })).toEqual({
      min: -48,
      max: 24,
    });
  });

  it("slides a window that overshot instead of clamping the bound that crossed", () => {
    // Clamping min to 0 here would leave 0..23 -- a span of 23 where the gesture asked for 22.
    expect(applyRangeConstraints({ min: 1, max: 23, ...MS_RATIO })).toEqual({ min: 0, max: 22 });
    expect(applyRangeConstraints({ min: -76, max: -4, ...MS_RATIO })).toEqual({
      min: -72,
      max: 0,
    });
  });

  it("keeps a pan rigid all the way to the stop", () => {
    // Without the constraint this run grew the span from 72 to 96: a drag that zoomed.
    let range = { min: -48, max: 24 };
    for (let i = 0; i < 5; i++) {
      range = applyRangeConstraints({
        ...computeLinearPan({ ...range, ...MS_RATIO, deltaPx: -40, axisPx: 200 }),
        ...MS_RATIO,
      });
      expect(range.max - range.min).toBe(72);
    }
    expect(range).toEqual({ min: -72, max: 0 });
  });

  it("keeps zooming once the window is resting against the reference", () => {
    // Clamping used to freeze the range at 0..23, so the wheel stopped doing anything.
    let range = { min: -48, max: 24 };
    const spans = [];
    for (let i = 0; i < 12; i++) {
      range = applyRangeConstraints({
        ...computeLinearZoom({ ...range, ...MS_RATIO, anchor: 20, factor: 0.85 }),
        ...MS_RATIO,
      });
      spans.push(range.max - range.min);
    }
    expect(range.min).toBe(0);
    expect(spans.at(-1)).toBeLessThan(spans[spans.length - 5]);
  });
});
