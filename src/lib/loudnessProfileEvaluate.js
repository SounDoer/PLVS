/// Pure evaluation of a Loudness Profile against one metrics sample.
///
/// The sample is exactly what the engine already emits:
///   { values: { [metricId]: number }, integratedReady: boolean, dialogueCoverage: number|null }
///
/// Returns a status only for the metrics the profile judges (those carrying a filled-in rule). A
/// metric absent from the result is unwatched; callers render that as muted.
///
/// Per metric: every filled rule is checked, a rule "fires" when its comparison is true, and the
/// status is the most severe fired rule (`fail` > `warn`), or `ok` when none fire. Two automatic
/// gates run first -- readiness (`pending`) and dialogue coverage (`inconclusive`) -- because a
/// reading that is not ready or not backed by enough dialogue must not be judged at all.

import {
  DIALOGUE_GATED_METRIC_IDS,
  MIN_DIALOGUE_COVERAGE_PERCENT,
  READINESS_GATED_METRIC_IDS,
  isRuleEmpty,
} from "./loudnessProfileCatalog.js";

const SEVERITY_RANK = { warn: 1, fail: 2 };

function ruleFires(rule, value) {
  if (rule.op === ">") return value > rule.value;
  if (rule.op === "<") return value < rule.value;
  return false;
}

function evaluateMetric(metricId, rules, sample) {
  // Integrated-family readouts are meaningless until the engine says they are ready.
  if (READINESS_GATED_METRIC_IDS.has(metricId) && !sample.integratedReady) return "pending";

  if (DIALOGUE_GATED_METRIC_IDS.has(metricId)) {
    const coverage = sample.dialogueCoverage;
    // Null coverage means the dialogue path is not running at all.
    if (!Number.isFinite(coverage) || coverage < MIN_DIALOGUE_COVERAGE_PERCENT) {
      return "inconclusive";
    }
  }

  const value = sample.values?.[metricId];
  if (!Number.isFinite(value)) return "pending";

  let worst = null;
  for (const rule of rules) {
    if (ruleFires(rule, value) && (!worst || SEVERITY_RANK[rule.severity] > SEVERITY_RANK[worst])) {
      worst = rule.severity;
    }
  }
  return worst ?? "ok";
}

export function loudnessProfileEvaluate(document, sample) {
  if (!document) return {};

  const byMetric = new Map();
  for (const rule of document.rules ?? []) {
    if (isRuleEmpty(rule)) continue;
    if (!byMetric.has(rule.metricId)) byMetric.set(rule.metricId, []);
    byMetric.get(rule.metricId).push(rule);
  }

  const statuses = {};
  for (const [metricId, rules] of byMetric) {
    statuses[metricId] = evaluateMetric(metricId, rules, sample ?? {});
  }
  return statuses;
}
