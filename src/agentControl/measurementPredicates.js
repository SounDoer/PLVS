export const MEASUREMENT_SIGNAL_FLOOR_DBFS = -90;

export const MEASUREMENT_AVAILABLE_METRICS = Object.freeze([
  "levels.truePeak.leftDbtp",
  "levels.truePeak.rightDbtp",
  "levels.truePeak.maxDbtp",
  "loudness.momentaryLufs",
  "loudness.shortTermLufs",
  "loudness.integratedLufs",
  "loudness.momentaryMaxLufs",
  "loudness.shortTermMaxLufs",
  "loudness.rangeLu",
  "loudness.psrDb",
  "loudness.plrDb",
  "stereo.correlation",
  "stereo.sideToMidDb",
  "dialogue.activeNow",
  "dialogue.coveragePercent",
  "dialogue.integratedLufs",
  "dialogue.rangeLu",
  "dialogue.offsetLu",
]);

export const MEASUREMENT_THRESHOLD_METRICS = Object.freeze(
  MEASUREMENT_AVAILABLE_METRICS.filter((metric) => metric !== "dialogue.activeNow")
);
export const MEASUREMENT_THRESHOLD_OPERATORS = Object.freeze([
  "above",
  "atOrAbove",
  "below",
  "atOrBelow",
]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(path, message) {
  return { ok: false, path, message };
}

export function normalizeMeasurementPredicate(value, path = "$.params.predicate") {
  if (!plainObject(value)) return failure(path, "predicate must be an object.");
  if (!["signalPresent", "metricAvailable", "metricThreshold"].includes(value.kind)) {
    return failure(
      `${path}.kind`,
      "kind must be signalPresent, metricAvailable, or metricThreshold."
    );
  }
  const allowed =
    value.kind === "signalPresent"
      ? new Set(["kind"])
      : value.kind === "metricAvailable"
        ? new Set(["kind", "metric"])
        : new Set(["kind", "metric", "operator", "value", "holdMs"]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) return failure(`${path}.${extra}`, `Unknown predicate field: ${extra}.`);
  if (value.kind === "signalPresent") return { ok: true, predicate: { kind: value.kind } };
  const metrics =
    value.kind === "metricAvailable"
      ? MEASUREMENT_AVAILABLE_METRICS
      : MEASUREMENT_THRESHOLD_METRICS;
  if (!metrics.includes(value.metric)) {
    return failure(`${path}.metric`, `metric is not supported for ${value.kind}.`);
  }
  if (value.kind === "metricAvailable") {
    return { ok: true, predicate: { kind: value.kind, metric: value.metric } };
  }
  if (!MEASUREMENT_THRESHOLD_OPERATORS.includes(value.operator)) {
    return failure(`${path}.operator`, "operator must be above, atOrAbove, below, or atOrBelow.");
  }
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
    return failure(`${path}.value`, "value must be a finite number.");
  }
  const holdMs = value.holdMs ?? 0;
  if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 300000) {
    return failure(`${path}.holdMs`, "holdMs must be an integer from 0 to 300000.");
  }
  return {
    ok: true,
    predicate: {
      kind: value.kind,
      metric: value.metric,
      operator: value.operator,
      value: value.value,
      holdMs,
    },
  };
}

export function readMeasurementMetric(measurement, metric) {
  return metric.split(".").reduce((value, key) => value?.[key], measurement);
}

export function measurementPredicateMatches(measurement, predicate) {
  if (measurement?.sample?.freshness !== "fresh") return false;
  if (predicate.kind === "signalPresent") {
    return (measurement.levels?.channels ?? []).some(
      ({ peakDbfs }) => Number.isFinite(peakDbfs) && peakDbfs > MEASUREMENT_SIGNAL_FLOOR_DBFS
    );
  }
  const value = readMeasurementMetric(measurement, predicate.metric);
  if (predicate.kind === "metricAvailable") return value !== null && value !== undefined;
  if (!Number.isFinite(value)) return false;
  if (predicate.operator === "above") return value > predicate.value;
  if (predicate.operator === "atOrAbove") return value >= predicate.value;
  if (predicate.operator === "below") return value < predicate.value;
  return value <= predicate.value;
}
