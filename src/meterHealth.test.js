import { describe, it, expect } from "vitest";
import { METER_HEALTH, normalizeMeterHealth, meterHealthBadgeModel } from "./meterHealth";

describe("normalizeMeterHealth", () => {
  it("defaults to ok for unknown values", () => {
    expect(normalizeMeterHealth(undefined)).toBe(METER_HEALTH.ok);
    expect(normalizeMeterHealth(null)).toBe(METER_HEALTH.ok);
    expect(normalizeMeterHealth("wat")).toBe(METER_HEALTH.ok);
  });
  it("accepts known states", () => {
    expect(normalizeMeterHealth(METER_HEALTH.ok)).toBe(METER_HEALTH.ok);
    expect(normalizeMeterHealth(METER_HEALTH.degraded)).toBe(METER_HEALTH.degraded);
    expect(normalizeMeterHealth(METER_HEALTH.stopped)).toBe(METER_HEALTH.stopped);
    expect(normalizeMeterHealth(METER_HEALTH.error)).toBe(METER_HEALTH.error);
  });
});

describe("meterHealthBadgeModel", () => {
  it("renders OK model", () => {
    expect(meterHealthBadgeModel("ok")).toEqual({
      health: "ok",
      label: "Meter: OK",
      tone: "ok",
    });
  });
  it("renders Degraded model", () => {
    expect(meterHealthBadgeModel("degraded")).toEqual({
      health: "degraded",
      label: "Meter: Degraded",
      tone: "warn",
    });
  });
  it("renders Error model", () => {
    expect(meterHealthBadgeModel("error")).toEqual({
      health: "error",
      label: "Meter: Error",
      tone: "error",
    });
  });
  it("renders Stopped model", () => {
    expect(meterHealthBadgeModel("stopped")).toEqual({
      health: "stopped",
      label: "Meter: Stopped",
      tone: "warn",
    });
  });
});

