/// Loudness Profile catalog: the Off/built-in/draft definitions and the selection-id helpers.
///
/// A rule document is the unit the rest of the feature consumes:
///   { id, name, kind, basedOn?, referenceLufs, metrics, preferredMetricIds }
/// `referenceLufs` drives the Loudness `ref` line and the footer reading; `null` means the
/// profile has no target and both surfaces hide (see the design doc, §Footer).
///
/// Metric ids are `statsCatalog` ids, so a rule can address any row Stats can already show.
///
/// A MetricRule is:
///   role      "target" | "limit" | "descriptor" | "na"
///   target / tolerance {minus, plus}   for role "target"
///   max / min                          for role "limit"
///   severity  "fail" | "warn"          breach severity; descriptors and "na" never breach
///   provisional                        conclusions never settle (realtime Live), not a timer
///   requiresDialogueCoverage           percent below which the rule is inconclusive
///
/// Built-ins are references with clear rules, not certification. See the design doc.

import { STATS_META } from "./statsCatalog.js";

export const LOUDNESS_PROFILE_OFF = "off";
export const LOUDNESS_PROFILE_CUSTOM = "unsaved-custom";

const BUILTIN_PREFIX = "builtin:";
const USER_PREFIX = "user:";

/// Below this dialogue coverage the dialogue-anchored rules cannot conclude.
export const MIN_DIALOGUE_COVERAGE_PERCENT = 15;

function target(value, minus, plus, extra = {}) {
  return { role: "target", target: value, tolerance: { minus, plus }, severity: "fail", ...extra };
}

function limitMax(value) {
  return { role: "limit", max: value, severity: "fail" };
}

function watchMax(value) {
  return { role: "limit", max: value, severity: "warn" };
}

const DESCRIPTOR = { role: "descriptor", severity: "warn" };
const NOT_APPLICABLE = { role: "na", severity: "warn" };

export const BUILTIN_LOUDNESS_PROFILES = [
  {
    id: "ebu-r128",
    name: "EBU R128",
    kind: "builtin",
    referenceLufs: -23,
    preferredMetricIds: ["integrated", "truePeak"],
    metrics: {
      integrated: target(-23, 0.5, 0.5),
      truePeak: limitMax(-1),
      lra: DESCRIPTOR,
      shortTermMax: DESCRIPTOR,
    },
  },
  {
    id: "ebu-r128-live",
    name: "EBU R128 Live",
    kind: "builtin",
    referenceLufs: -23,
    preferredMetricIds: ["integrated", "truePeak"],
    metrics: {
      // Realtime Integrated never settles, so this is provisional by construction rather than
      // after some elapsed time. There is no gated-audio clock to wait on.
      integrated: target(-23, 1, 1, { provisional: true }),
      truePeak: limitMax(-1),
      lra: DESCRIPTOR,
      shortTermMax: DESCRIPTOR,
    },
  },
  {
    id: "ebu-r128-s1",
    name: "EBU R128 S1",
    kind: "builtin",
    referenceLufs: -23,
    preferredMetricIds: ["integrated", "shortTermMax", "truePeak"],
    metrics: {
      integrated: target(-23, 0.5, 0.5),
      shortTermMax: limitMax(-18),
      truePeak: limitMax(-1),
      // Short-form programmes are too short for LRA to mean anything.
      lra: NOT_APPLICABLE,
    },
  },
  {
    id: "atsc-a85",
    name: "ATSC A/85",
    kind: "builtin",
    referenceLufs: -24,
    preferredMetricIds: ["dialogueIntegrated", "dialogueCoverage", "truePeak"],
    metrics: {
      dialogueIntegrated: target(-24, 2, 2, {
        requiresDialogueCoverage: MIN_DIALOGUE_COVERAGE_PERCENT,
      }),
      truePeak: limitMax(-2),
      dialogueCoverage: DESCRIPTOR,
      integrated: DESCRIPTOR,
    },
  },
  {
    id: "streaming-14",
    name: "Streaming −14",
    kind: "builtin",
    referenceLufs: -14,
    preferredMetricIds: ["integrated", "truePeak"],
    metrics: {
      // A playback-normalisation reference, not an upload gate, so the band is loose and the
      // breach is a warning rather than a failure.
      integrated: { ...target(-14, 1, 1), severity: "warn" },
      truePeak: watchMax(-1),
      lra: DESCRIPTOR,
    },
  },
];

/// The rule shape each Stats metric can wear.
///
/// `role` is an implementation concept -- nobody thinks "I want a limit rule on True Peak", they
/// think "TP must not exceed -1" -- so the editor reads the shape from here instead of asking.
/// `limit` carries both `min` and `max`, which makes ceiling, floor and band the same shape with
/// different fields left blank; `reading` only decides which input leads and what the hint says.
///
/// Deliberately no default numbers. Inventing a threshold for Side/Mid or PSR would be exactly
/// the fabricated-standard behaviour this feature exists to avoid.
export const METRIC_RULE_SHAPE = {
  momentary: { role: "target", reading: "sits-at" },
  shortTerm: { role: "target", reading: "sits-at" },
  integrated: { role: "target", reading: "sits-at" },
  dialogueIntegrated: { role: "target", reading: "sits-at" },
  momentaryMax: { role: "limit", reading: "ceiling" },
  shortTermMax: { role: "limit", reading: "ceiling" },
  truePeak: { role: "limit", reading: "ceiling" },
  dialogueCoverage: { role: "limit", reading: "floor" },
  correlation: { role: "limit", reading: "floor" },
  psr: { role: "limit", reading: "floor" },
  plr: { role: "limit", reading: "floor" },
  lra: { role: "limit", reading: "band" },
  dialogueRange: { role: "limit", reading: "band" },
  dialogueOffset: { role: "limit", reading: "band" },
  sideToMid: { role: "limit", reading: "band" },
};

/// A rule in the metric's own shape with nothing filled in. Severity defaults to `fail`; the
/// editor exposes it, and a user who wants a softer breach says so.
export function createEmptyRule(metricId) {
  const shape = METRIC_RULE_SHAPE[metricId];
  if (!shape) return null;
  return { role: shape.role, severity: "fail" };
}

const BUILTIN_BY_ID = new Map(BUILTIN_LOUDNESS_PROFILES.map((p) => [p.id, p]));

export function createDefaultCustomDraft() {
  return {
    id: "custom",
    name: "Custom",
    kind: "draft",
    referenceLufs: -23,
    preferredMetricIds: ["integrated", "truePeak"],
    metrics: {
      integrated: target(-23, 0.5, 0.5),
      truePeak: limitMax(-1),
    },
  };
}

const defaultMakeId = () => `${crypto.randomUUID()}`;

/// Duplicating a built-in yields an unsaved draft, never a library entry: the design routes all
/// edits of a built-in through Duplicate -> Save as.
export function duplicateAsDraft(builtinId, makeId = defaultMakeId) {
  const source = BUILTIN_BY_ID.get(builtinId);
  if (!source) return null;
  return {
    ...structuredClone(source),
    id: makeId(),
    name: `${source.name} (copy)`,
    kind: "draft",
    basedOn: source.id,
  };
}

/// The metric the reference value is *about*: the first preferred metric the profile targets.
/// For the default draft and the EBU/Streaming copies that is `integrated`; for an ATSC copy it
/// is `dialogueIntegrated`, which is the whole reason this is not hard-coded to `integrated`.
///
/// Empty rules are skipped -- an unfilled rule at the front of the list would absorb the anchor
/// and leave the real target rule behind, moving the chart line while Stats kept judging against
/// the old number, which is the split this function exists to prevent.
function anchorMetricId(document) {
  return (document?.preferredMetricIds ?? []).find((id) => {
    const rule = document.metrics?.[id];
    return rule?.role === "target" && !isRuleEmpty(rule);
  });
}

/// Moves a document's reference, carrying its anchor target rule along.
///
/// These two are one number wearing two hats -- the line drawn on the chart and the value Stats
/// judges against -- so letting the editor write only `referenceLufs` produces a profile that
/// draws its line at one loudness and fails you against another. The tolerance band is the
/// user's, so it rides along unchanged.
export function withReferenceLufs(document, referenceLufs) {
  if (!document) return document;
  const anchor = anchorMetricId(document);
  if (!anchor) return { ...document, referenceLufs };
  return {
    ...document,
    referenceLufs,
    metrics: {
      ...document.metrics,
      [anchor]: { ...document.metrics[anchor], target: referenceLufs },
    },
  };
}

export function builtinSelectionId(id) {
  return `${BUILTIN_PREFIX}${id}`;
}

export function userSelectionId(id) {
  return `${USER_PREFIX}${id}`;
}

/// Parses a selection id into { kind, id }. Unknown shapes read as Off so a corrupt persisted
/// value degrades to the default rather than throwing.
export function parseSelection(selection) {
  if (selection === LOUDNESS_PROFILE_CUSTOM) return { kind: "draft", id: null };
  if (typeof selection === "string") {
    if (selection.startsWith(BUILTIN_PREFIX)) {
      return { kind: "builtin", id: selection.slice(BUILTIN_PREFIX.length) };
    }
    if (selection.startsWith(USER_PREFIX)) {
      return { kind: "user", id: selection.slice(USER_PREFIX.length) };
    }
  }
  return { kind: "off", id: null };
}

/// Resolves the active selection to a rule document, or null when there is nothing to evaluate.
/// Null covers Off, a missing custom draft, and a `user:<id>` that is no longer in the library
/// (a preset can outlive the profile it referenced).
export function resolveActiveDocument(state) {
  const { kind, id } = parseSelection(state?.active);
  if (kind === "off") return null;
  if (kind === "draft") return state?.customDraft ?? null;
  if (kind === "builtin") return BUILTIN_BY_ID.get(id) ?? null;
  return (state?.userProfiles ?? []).find((p) => p.id === id) ?? null;
}

/// Every metric a rule can address must be a real Stats row, otherwise the rule is unreachable
/// and "missing stats" could never be satisfied.
export function isKnownMetricId(metricId) {
  return Object.hasOwn(STATS_META, metricId);
}

/// A rule the user has added but not yet filled in. It judges nothing and demands nothing, and
/// it has to survive a round-trip: the alternative is a row that vanishes when the panel closes.
///
/// A target needs both halves. With a target but no band, `evaluateTarget` would compare against
/// a zero-width band, which the near-boundary margin turns into a permanent warning that can
/// never read ok -- a half-typed rule should be silent, not shouting. Defaulting the band instead
/// would mean inventing a threshold, which is the thing this feature exists to avoid.
///
/// `descriptor` and `na` are deliberate annotations rather than half-finished rules, so they are
/// never empty.
/// A band both halves of which are usable. Exported because the normalizer and `isRuleEmpty` have
/// to agree on this exactly: when they disagree, a half-typed band reads as filled and then
/// evaluates against `target + undefined`, which is NaN -- and every comparison against NaN is
/// false, so the rule silently passes everything.
export function isUsableTolerance(tolerance) {
  const minus = Number(tolerance?.minus);
  const plus = Number(tolerance?.plus);
  if (!Number.isFinite(minus) || !Number.isFinite(plus)) return false;
  return minus >= 0 && plus >= 0;
}

export function isRuleEmpty(rule) {
  if (!rule) return true;
  if (rule.role === "target")
    return !Number.isFinite(rule.target) || !isUsableTolerance(rule.tolerance);
  if (rule.role === "limit") return !Number.isFinite(rule.max) && !Number.isFinite(rule.min);
  return false;
}
