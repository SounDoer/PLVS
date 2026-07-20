/// Pure evaluation of a Loudness Profile against one metrics sample.
///
/// The sample is exactly what the engine already emits (see the design doc, §Evaluation input
/// contract) -- no new engine data, and deliberately no elapsed-time field:
///
///   { values: { [metricId]: number }, integratedReady: boolean, dialogueCoverage: number|null }
///
/// Returns a status per metric the document addresses. A metric absent from the result is
/// unwatched; callers render that as muted, so Off (a null document) yields an empty map.

/// Distance from a band edge at which a passing value is already worth a warning.
const NEAR_BOUNDARY_MARGIN = 0.5;

function breachStatus(rule) {
  // `provisional` caps the severity: a realtime conclusion is never certain enough to fail on.
  if (rule.provisional) return "warn";
  return rule.severity === "fail" ? "fail" : "warn";
}

function evaluateLimit(rule, value) {
  if (Number.isFinite(rule.max)) {
    if (value > rule.max) return breachStatus(rule);
    if (value > rule.max - NEAR_BOUNDARY_MARGIN) return "warn";
  }
  if (Number.isFinite(rule.min)) {
    if (value < rule.min) return breachStatus(rule);
    if (value < rule.min + NEAR_BOUNDARY_MARGIN) return "warn";
  }
  return "ok";
}

function evaluateTarget(rule, value) {
  const low = rule.target - rule.tolerance.minus;
  const high = rule.target + rule.tolerance.plus;
  if (value < low || value > high) return breachStatus(rule);
  if (value < low + NEAR_BOUNDARY_MARGIN || value > high - NEAR_BOUNDARY_MARGIN) return "warn";
  return "ok";
}

function evaluateMetric(metricId, rule, sample) {
  if (rule.role === "descriptor" || rule.role === "watch") return "unwatched";

  // Integrated-family readouts are meaningless until the engine says they are ready.
  if (metricId === "integrated" && !sample.integratedReady) return "pending";

  if (Number.isFinite(rule.requiresDialogueCoverage)) {
    const coverage = sample.dialogueCoverage;
    // Null coverage means the dialogue path is not running at all.
    if (!Number.isFinite(coverage) || coverage < rule.requiresDialogueCoverage) {
      return "inconclusive";
    }
  }

  const value = sample.values?.[metricId];
  if (!Number.isFinite(value)) return "pending";

  if (rule.role === "limit") return evaluateLimit(rule, value);
  if (rule.role === "target") return evaluateTarget(rule, value);
  return "unwatched";
}

export function loudnessProfileEvaluate(document, sample) {
  if (!document) return {};

  const preferred = new Set(document.preferredMetricIds ?? []);
  const statuses = {};

  for (const [metricId, rule] of Object.entries(document.metrics ?? {})) {
    if (rule.role === "na") {
      // "Not applicable" is a claim the profile makes about the metric itself, so it outranks
      // the watched check -- otherwise an n/a metric the profile does not prefer (S1's LRA)
      // would be indistinguishable from one with no rule, and tips could never say N/A.
      statuses[metricId] = "na";
      continue;
    }
    // A rule the profile does not actually care about is not a judgement.
    statuses[metricId] = preferred.has(metricId)
      ? evaluateMetric(metricId, rule, sample ?? {})
      : "unwatched";
  }

  return statuses;
}

/// Colour intent per status, so Stats and the Level Meter cannot drift apart.
export const STATUS_IS_BREACH = new Set(["fail"]);
export const STATUS_IS_CAUTION = new Set(["warn", "pending", "inconclusive"]);
