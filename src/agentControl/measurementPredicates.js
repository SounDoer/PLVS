import { suggestNames } from "./nameSuggestions.js";

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
  "dialogue.loudnessLufs",
  "dialogue.rangeLu",
  "dialogue.loudnessToDialogueRatioLu",
]);

export const MEASUREMENT_THRESHOLD_METRICS = Object.freeze(
  MEASUREMENT_AVAILABLE_METRICS.filter((metric) => metric !== "dialogue.activeNow")
);
/** Per-channel readings `channelThreshold` compares, from `levels.channels[]`. */
export const MEASUREMENT_CHANNEL_METRICS = Object.freeze(["peakDbfs", "rmsDbfs"]);

/** Loudness Profile overall statuses, least to most severe; `off` means no profile applies. */
export const MEASUREMENT_PROFILE_STATUSES = Object.freeze(["off", "ok", "pending", "warn", "fail"]);

export const MEASUREMENT_THRESHOLD_OPERATORS = Object.freeze([
  "above",
  "atOrAbove",
  "below",
  "atOrBelow",
]);

/** Fields each predicate kind accepts besides `kind`. */
const PREDICATE_FIELDS = Object.freeze({
  signalPresent: [],
  signalAbsent: ["holdMs"],
  metricAvailable: ["metric"],
  metricThreshold: ["metric", "operator", "value", "holdMs"],
  channelThreshold: ["channel", "metric", "operator", "value", "holdMs"],
  profileStatus: ["status", "operator", "holdMs"],
});
const PREDICATE_KINDS = Object.freeze(Object.keys(PREDICATE_FIELDS));

/** "a, b, or c" */
function listed(values) {
  return values.length < 3
    ? values.join(" or ")
    : `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function didYouMean(input, candidates) {
  const suggestions = suggestNames(input, candidates);
  return suggestions.length > 0 ? ` Did you mean ${listed(suggestions)}?` : "";
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} path
 * @param {string} message
 */
function failure(path, message) {
  return { ok: false, path, message };
}

export function normalizeMeasurementPredicate(value, path = "$.params.predicate") {
  if (!plainObject(value)) return failure(path, "predicate must be an object.");
  if (value.kind === undefined && plainObject(value.predicate)) {
    return failure(
      `${path}.predicate`,
      'The input is the predicate itself: remove the "predicate" wrapper.'
    );
  }
  if (!PREDICATE_KINDS.includes(value.kind)) {
    return failure(
      `${path}.kind`,
      `kind must be ${listed(PREDICATE_KINDS)}.${didYouMean(value.kind, PREDICATE_KINDS)}`
    );
  }
  const allowed = new Set(["kind", ...PREDICATE_FIELDS[value.kind]]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) return failure(`${path}.${extra}`, `Unknown predicate field: ${extra}.`);

  const predicate = { kind: value.kind };
  if (value.kind === "channelThreshold") {
    if (
      typeof value.channel !== "string" ||
      value.channel.length < 1 ||
      value.channel.length > 32
    ) {
      return failure(`${path}.channel`, "channel must be a channel label of 1 to 32 characters.");
    }
    predicate.channel = value.channel;
  }
  if (
    value.kind === "metricAvailable" ||
    value.kind === "metricThreshold" ||
    value.kind === "channelThreshold"
  ) {
    const metrics =
      value.kind === "metricAvailable"
        ? MEASUREMENT_AVAILABLE_METRICS
        : value.kind === "metricThreshold"
          ? MEASUREMENT_THRESHOLD_METRICS
          : MEASUREMENT_CHANNEL_METRICS;
    if (!metrics.includes(value.metric)) {
      return failure(
        `${path}.metric`,
        `metric is not supported for ${value.kind}.${didYouMean(value.metric, metrics)}`
      );
    }
    predicate.metric = value.metric;
  }
  if (value.kind === "profileStatus") {
    if (!MEASUREMENT_PROFILE_STATUSES.includes(value.status)) {
      return failure(
        `${path}.status`,
        `status must be ${listed(MEASUREMENT_PROFILE_STATUSES)}.${didYouMean(value.status, MEASUREMENT_PROFILE_STATUSES)}`
      );
    }
    predicate.status = value.status;
    if (value.operator !== undefined) {
      if (value.operator !== "atOrAbove" || value.status === "off") {
        return failure(
          `${path}.operator`,
          'operator for profileStatus is "atOrAbove", with a status other than off.'
        );
      }
      predicate.operator = value.operator;
    }
  }
  if (value.kind === "metricThreshold" || value.kind === "channelThreshold") {
    if (!MEASUREMENT_THRESHOLD_OPERATORS.includes(value.operator)) {
      return failure(
        `${path}.operator`,
        `operator must be ${listed(MEASUREMENT_THRESHOLD_OPERATORS)}.`
      );
    }
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
      return failure(`${path}.value`, "value must be a finite number.");
    }
    predicate.operator = value.operator;
    predicate.value = value.value;
  }
  if (allowed.has("holdMs")) {
    const holdMs = value.holdMs ?? 0;
    if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 300000) {
      return failure(`${path}.holdMs`, "holdMs must be an integer from 0 to 300000.");
    }
    predicate.holdMs = holdMs;
  }
  return { ok: true, predicate };
}

/**
 * @param {string} metric
 */
export function readMeasurementMetric(measurement, metric) {
  return metric.split(".").reduce((value, key) => value?.[key], measurement);
}

function compare(value, operator, threshold) {
  if (!Number.isFinite(value)) return false;
  if (operator === "above") return value > threshold;
  if (operator === "atOrAbove") return value >= threshold;
  if (operator === "below") return value < threshold;
  return value <= threshold;
}

export function measurementPredicateMatches(measurement, predicate) {
  if (measurement?.sample?.freshness !== "fresh") return false;
  const channels = measurement.levels?.channels ?? [];
  const audible = ({ peakDbfs }) =>
    Number.isFinite(peakDbfs) && peakDbfs > MEASUREMENT_SIGNAL_FLOOR_DBFS;
  if (predicate.kind === "signalPresent") return channels.some(audible);
  if (predicate.kind === "signalAbsent") return channels.length > 0 && !channels.some(audible);
  if (predicate.kind === "channelThreshold") {
    const channel = channels.find(({ label }) => label === predicate.channel);
    return compare(channel?.[predicate.metric], predicate.operator, predicate.value);
  }
  if (predicate.kind === "profileStatus") {
    const overall = measurement.profile?.overall;
    if (predicate.operator !== "atOrAbove") return overall === predicate.status;
    const rank = MEASUREMENT_PROFILE_STATUSES.indexOf(overall);
    return rank > 0 && rank >= MEASUREMENT_PROFILE_STATUSES.indexOf(predicate.status);
  }
  const value = readMeasurementMetric(measurement, predicate.metric);
  if (predicate.kind === "metricAvailable") return value !== null && value !== undefined;
  return compare(value, predicate.operator, predicate.value);
}
