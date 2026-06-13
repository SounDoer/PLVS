import { describe, it, expect } from "vitest";
import {
  fmtMetric,
  fmtSec,
  METRIC_NEGATIVE_INFINITY_FLOOR,
  METRIC_POSITIVE_INFINITY_CEIL,
} from "./formatMath";

describe("fmtMetric", () => {
  it("formats a normal value to 1 decimal place", () => {
    expect(fmtMetric(-23)).toBe("-23.0");
    expect(fmtMetric(-14.5)).toBe("-14.5");
    expect(fmtMetric(0)).toBe("0.0");
  });
  it("returns '-' for non-finite values", () => {
    expect(fmtMetric(-Infinity)).toBe("-");
    expect(fmtMetric(Infinity)).toBe("-");
    expect(fmtMetric(NaN)).toBe("-");
  });
  it("returns '-' at or below the negative floor", () => {
    expect(fmtMetric(METRIC_NEGATIVE_INFINITY_FLOOR)).toBe("-");
    expect(fmtMetric(METRIC_NEGATIVE_INFINITY_FLOOR - 1)).toBe("-");
  });
  it("shows the widest 5-char value but floors anything rounding to -100.0", () => {
    expect(fmtMetric(-99.9)).toBe("-99.9");
    expect(fmtMetric(-99.96)).toBe("-"); // would render "-100.0" (6 chars)
    expect(fmtMetric(-120)).toBe("-");
  });
  it("returns '-' at or above the positive ceiling", () => {
    expect(fmtMetric(METRIC_POSITIVE_INFINITY_CEIL)).toBe("-");
    expect(fmtMetric(METRIC_POSITIVE_INFINITY_CEIL + 1)).toBe("-");
  });
});

describe("fmtSec", () => {
  it("formats seconds under 60", () => {
    expect(fmtSec(0)).toBe("0s");
    expect(fmtSec(45)).toBe("45s");
    expect(fmtSec(59)).toBe("59s");
  });
  it("formats exactly 60s as 1m", () => {
    expect(fmtSec(60)).toBe("1m");
  });
  it("formats minutes and remaining seconds", () => {
    expect(fmtSec(90)).toBe("1m30s");
    expect(fmtSec(120)).toBe("2m");
    expect(fmtSec(125)).toBe("2m5s");
  });
  it("clamps negative values to 0", () => {
    expect(fmtSec(-5)).toBe("0s");
  });
  it("rounds to nearest second", () => {
    expect(fmtSec(1.4)).toBe("1s");
    expect(fmtSec(1.6)).toBe("2s");
  });
});
