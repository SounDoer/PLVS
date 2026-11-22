import { describe, expect, it } from "vitest";
import {
  measurementPredicateMatches,
  normalizeMeasurementPredicate,
} from "./measurementPredicates.js";

const measurement = {
  sample: { freshness: "fresh" },
  levels: { channels: [{ peakDbfs: -18 }], truePeak: { maxDbtp: -3 } },
  loudness: { integratedLufs: -23 },
  dialogue: { activeNow: false },
};

describe("measurement wait predicates", () => {
  it("normalizes the three bounded predicate kinds", () => {
    expect(normalizeMeasurementPredicate({ kind: "signalPresent" })).toEqual({
      ok: true,
      predicate: { kind: "signalPresent" },
    });
    expect(
      normalizeMeasurementPredicate({
        kind: "metricAvailable",
        metric: "loudness.integratedLufs",
      })
    ).toMatchObject({ ok: true });
    expect(
      normalizeMeasurementPredicate({
        kind: "metricThreshold",
        metric: "levels.truePeak.maxDbtp",
        operator: "below",
        value: -1,
      })
    ).toEqual({
      ok: true,
      predicate: {
        kind: "metricThreshold",
        metric: "levels.truePeak.maxDbtp",
        operator: "below",
        value: -1,
        holdMs: 0,
      },
    });
  });

  it("rejects unknown fields, arbitrary paths, and invalid holds", () => {
    expect(
      normalizeMeasurementPredicate({ kind: "signalPresent", expression: "true" })
    ).toMatchObject({
      ok: false,
      path: "$.params.predicate.expression",
    });
    expect(
      normalizeMeasurementPredicate({ kind: "metricAvailable", metric: "window.secret" })
    ).toMatchObject({ ok: false, path: "$.params.predicate.metric" });
    expect(
      normalizeMeasurementPredicate({
        kind: "metricThreshold",
        metric: "loudness.integratedLufs",
        operator: "above",
        value: -30,
        holdMs: 300001,
      })
    ).toMatchObject({ ok: false, path: "$.params.predicate.holdMs" });
  });

  it("matches only fresh signal, availability, and numeric thresholds", () => {
    expect(measurementPredicateMatches(measurement, { kind: "signalPresent" })).toBe(true);
    expect(
      measurementPredicateMatches(measurement, {
        kind: "metricAvailable",
        metric: "dialogue.activeNow",
      })
    ).toBe(true);
    expect(
      measurementPredicateMatches(measurement, {
        kind: "metricThreshold",
        metric: "loudness.integratedLufs",
        operator: "atOrAbove",
        value: -24,
      })
    ).toBe(true);
    expect(
      measurementPredicateMatches(
        { ...measurement, sample: { freshness: "stale" } },
        { kind: "signalPresent" }
      )
    ).toBe(false);
  });
});

describe("predicate input mistakes", () => {
  it("explains a predicate wrapper and suggests the intended kind and metric", () => {
    expect(normalizeMeasurementPredicate({ predicate: { kind: "signalPresent" } })).toEqual({
      ok: false,
      path: "$.params.predicate.predicate",
      message: 'The input is the predicate itself: remove the "predicate" wrapper.',
    });
    expect(normalizeMeasurementPredicate({ kind: "signalPresnt" }).message).toMatch(
      /^kind must be signalPresent, signalAbsent, .*\. Did you mean signalPresent\?$/
    );
    expect(
      normalizeMeasurementPredicate({ kind: "metricAvailable", metric: "loudness.integrated" })
        .message
    ).toBe("metric is not supported for metricAvailable. Did you mean loudness.integratedLufs?");
  });
});

describe("silence, channel and Loudness Profile predicates", () => {
  const measurement = (channels, overall = "ok") => ({
    sample: { freshness: "fresh" },
    levels: { channels },
    profile: { overall },
  });
  const L = (peakDbfs, rmsDbfs = peakDbfs - 6) => ({ index: 0, label: "L", peakDbfs, rmsDbfs });
  const R = (peakDbfs, rmsDbfs = peakDbfs - 6) => ({ index: 1, label: "R", peakDbfs, rmsDbfs });

  it("waits for every channel to fall to the signal floor", () => {
    const { predicate } = normalizeMeasurementPredicate({ kind: "signalAbsent", holdMs: 2000 });
    expect(predicate).toEqual({ kind: "signalAbsent", holdMs: 2000 });
    expect(measurementPredicateMatches(measurement([L(-95), R(null)]), predicate)).toBe(true);
    expect(measurementPredicateMatches(measurement([L(-95), R(-40)]), predicate)).toBe(false);
    expect(measurementPredicateMatches(measurement([]), predicate)).toBe(false);
  });

  it("compares one channel's peak or RMS by its label", () => {
    const { predicate } = normalizeMeasurementPredicate({
      kind: "channelThreshold",
      channel: "R",
      metric: "peakDbfs",
      operator: "above",
      value: -6,
    });
    expect(predicate).toEqual({
      kind: "channelThreshold",
      channel: "R",
      metric: "peakDbfs",
      operator: "above",
      value: -6,
      holdMs: 0,
    });
    expect(measurementPredicateMatches(measurement([L(-1), R(-12)]), predicate)).toBe(false);
    expect(measurementPredicateMatches(measurement([L(-12), R(-3)]), predicate)).toBe(true);
    expect(measurementPredicateMatches(measurement([L(-3)]), predicate)).toBe(false);
    expect(
      normalizeMeasurementPredicate({ kind: "channelThreshold", channel: "L", metric: "peak" })
        .message
    ).toBe("metric is not supported for channelThreshold. Did you mean peakDbfs?");
  });

  it("matches a Loudness Profile status exactly or at a severity", () => {
    const exact = normalizeMeasurementPredicate({
      kind: "profileStatus",
      status: "warn",
    }).predicate;
    const severe = normalizeMeasurementPredicate({
      kind: "profileStatus",
      status: "warn",
      operator: "atOrAbove",
    }).predicate;
    expect(measurementPredicateMatches(measurement([L(-20)], "warn"), exact)).toBe(true);
    expect(measurementPredicateMatches(measurement([L(-20)], "fail"), exact)).toBe(false);
    expect(measurementPredicateMatches(measurement([L(-20)], "fail"), severe)).toBe(true);
    expect(measurementPredicateMatches(measurement([L(-20)], "pending"), severe)).toBe(false);
    expect(measurementPredicateMatches(measurement([L(-20)], "off"), severe)).toBe(false);
    expect(
      normalizeMeasurementPredicate({ kind: "profileStatus", status: "off", operator: "atOrAbove" })
        .ok
    ).toBe(false);
    expect(
      normalizeMeasurementPredicate({ kind: "profileStatus", status: "warn", operator: "below" }).ok
    ).toBe(false);
  });
});
