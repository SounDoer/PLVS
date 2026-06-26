import { describe, expect, it } from "vitest";
import {
  computeLinearPan,
  computeLinearZoom,
  computeLogPan,
  computeLogZoom,
  pixelToLinearValue,
  pixelToLogValue,
} from "./axisInteractionMath";

describe("axisInteractionMath", () => {
  it("zooms linear ranges around an anchor and clamps to bounds", () => {
    const result = computeLinearZoom({
      min: -96,
      max: -12,
      absMin: -120,
      absMax: 6,
      minSpan: 12,
      anchor: -54,
      factor: 0.5,
    });
    expect(result.max - result.min).toBeCloseTo(42);
    expect(result.min).toBeLessThan(-54);
    expect(result.max).toBeGreaterThan(-54);

    const expanded = computeLinearZoom({
      ...result,
      absMin: -120,
      absMax: 6,
      minSpan: 12,
      anchor: -54,
      factor: 99,
    });
    expect(expanded).toEqual({ min: -120, max: 6 });
  });

  it("zooms log ranges in octave space", () => {
    const result = computeLogZoom({
      min: 20,
      max: 20000,
      absMin: 20,
      absMax: 20000,
      minOctaves: 1,
      anchor: 1000,
      factor: 0.5,
    });
    expect(Math.log2(result.max / result.min)).toBeCloseTo(Math.log2(20000 / 20) * 0.5, 1);
    expect(result.min).toBeLessThan(1000);
    expect(result.max).toBeGreaterThan(1000);
  });

  it("pans linear and log ranges while preserving span", () => {
    const linear = computeLinearPan({
      min: -96,
      max: -12,
      absMin: -120,
      absMax: 6,
      deltaPx: 100,
      axisPx: 400,
    });
    expect(linear.min).toBeCloseTo(-78);
    expect(linear.max).toBeCloseTo(6);

    const log = computeLogPan({
      min: 100,
      max: 10000,
      absMin: 20,
      absMax: 20000,
      deltaPx: 50,
      axisPx: 400,
    });
    expect(log.min).toBeGreaterThan(100);
    expect(Math.log2(log.max / log.min)).toBeCloseTo(Math.log2(10000 / 100));
  });

  it("keeps full linear ranges on integer bounds while dragging", () => {
    const linear = computeLinearPan({
      min: -60,
      max: 3,
      absMin: -60,
      absMax: 3,
      deltaPx: 20,
      axisPx: 640,
    });

    expect(linear).toEqual({ min: -60, max: 3 });
  });

  it("maps pixels to values using top-is-max axis orientation", () => {
    expect(pixelToLinearValue(0, 400, -96, -12)).toBeCloseTo(-12);
    expect(pixelToLinearValue(400, 400, -96, -12)).toBeCloseTo(-96);
    expect(pixelToLinearValue(200, 400, -96, -12)).toBeCloseTo(-54);
    expect(pixelToLogValue(0, 400, 20, 20000)).toBeCloseTo(20000);
    expect(pixelToLogValue(400, 400, 20, 20000)).toBeCloseTo(20);
  });
});
