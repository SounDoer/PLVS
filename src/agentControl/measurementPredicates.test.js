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
