/// Loudness Profile catalog: the Off/built-in/draft definitions and the selection-id helpers.
///
/// A rule document is the unit the rest of the feature consumes:
///   { id, name, kind, basedOn?, referenceLufs, rules }
/// `referenceLufs` only draws the Loudness `ref` guide line and the footer reading; it judges
/// nothing. `null` means "no line". `rules` is a flat list; one metric may carry several.
///
/// A rule is one atomic breach condition:
///   metricId   a `statsCatalog` id -- any row Stats can already show
///   op         ">" | "<"          -- the side that breaches ("above" / "below")
///   value      the threshold (a number somebody typed; blank = not judged)
///   severity   "warn" | "fail"    -- how bad the breach is
///
/// Two automatic, metric-level gates are not expressed as rules (nobody configures them):
/// `integrated` reads `pending` until the engine says it is ready, and the dialogue-anchored
/// metrics read `inconclusive` until enough dialogue is present. "Only warn, never fail" (realtime
/// Integrated) is just a rule authored with `severity: "warn"`.
///
/// Built-ins are references with clear rules, not certification. See the design doc.

import { STATS_META } from "./statsCatalog.js";

export const LOUDNESS_PROFILE_OFF = "off";

const BUILTIN_PREFIX = "builtin:";
const USER_PREFIX = "user:";

/// Below this dialogue coverage the dialogue-anchored metrics cannot conclude.
export const MIN_DIALOGUE_COVERAGE_PERCENT = 15;

/// Metrics whose reading is meaningless until enough of the recent audio is dialogue. Any rule on
/// one of these is gated automatically -- the user neither sets nor sees the coverage floor.
export const DIALOGUE_GATED_METRIC_IDS = new Set(["dialogueIntegrated"]);

/// Metrics that only mean anything once the engine reports them settled.
export const READINESS_GATED_METRIC_IDS = new Set(["integrated"]);

/// The Stats metrics a rule may address. Deliberately no default numbers: inventing a threshold for
/// Side/Mid or PSR would be the fabricated-standard behaviour this feature exists to avoid.
export const RULEABLE_METRIC_IDS = [
  "momentary",
  "shortTerm",
  "integrated",
  "dialogueIntegrated",
  "momentaryMax",
  "shortTermMax",
  "truePeak",
  "dialogueCoverage",
  "correlation",
  "psr",
  "plr",
  "lra",
  "dialogueRange",
  "dialogueOffset",
  "sideToMid",
];

const RULEABLE_METRIC_SET = new Set(RULEABLE_METRIC_IDS);

function rule(metricId, op, value, severity = "fail") {
  return { metricId, op, value, severity };
}

/// A target band `t ± (minus, plus)` expressed as the two breach rules it really is.
function band(metricId, t, minus, plus, severity = "fail") {
  return [rule(metricId, ">", t + plus, severity), rule(metricId, "<", t - minus, severity)];
}

export const BUILTIN_LOUDNESS_PROFILES = [
  {
    id: "ebu-r128",
    name: "EBU R128",
    kind: "builtin",
    referenceLufs: -23,
    rules: [...band("integrated", -23, 0.5, 0.5), rule("truePeak", ">", -1)],
  },
  {
    id: "ebu-r128-live",
    name: "EBU R128 Live",
    kind: "builtin",
    referenceLufs: -23,
    // Realtime Integrated never settles, so it only warns -- it is never certain enough to fail on.
    rules: [...band("integrated", -23, 1, 1, "warn"), rule("truePeak", ">", -1)],
  },
  {
    id: "ebu-r128-s1",
    name: "EBU R128 S1",
    kind: "builtin",
    referenceLufs: -23,
    // Short-form programmes are too short for LRA to mean anything, so S1 simply does not judge it.
    rules: [
      ...band("integrated", -23, 0.5, 0.5),
      rule("shortTermMax", ">", -18),
      rule("truePeak", ">", -1),
    ],
  },
  {
    id: "atsc-a85",
    name: "ATSC A/85",
    kind: "builtin",
    referenceLufs: -24,
    // dialogueIntegrated is coverage-gated automatically (see DIALOGUE_GATED_METRIC_IDS).
    rules: [...band("dialogueIntegrated", -24, 2, 2), rule("truePeak", ">", -2)],
  },
  {
    id: "streaming-14",
    name: "Streaming −14",
    kind: "builtin",
    // A playback-normalisation reference, not an upload gate: loose band, warn rather than fail.
    referenceLufs: -14,
    rules: [...band("integrated", -14, 1, 1, "warn"), rule("truePeak", ">", -1, "warn")],
  },
];

/// A rule the user has just added but not filled in. Severity defaults to `fail`; a user who wants
/// a softer breach changes it. `op` defaults to `>` (a ceiling), the commonest case.
export function createEmptyRule(metricId) {
  if (!RULEABLE_METRIC_SET.has(metricId)) return null;
  return { metricId, op: ">", value: undefined, severity: "fail" };
}

const BUILTIN_BY_ID = new Map(BUILTIN_LOUDNESS_PROFILES.map((p) => [p.id, p]));

/// The starter a New profile opens on. Integrated and True Peak are the rules every delivery
/// reference in the catalog shares, and a blank editor is a dead end. The name starts empty so
/// Save stays disabled until the user names it.
export function createProfileDraft() {
  return {
    id: "draft",
    name: "",
    kind: "draft",
    referenceLufs: -23,
    rules: [...band("integrated", -23, 0.5, 0.5), rule("truePeak", ">", -1)],
  };
}

const defaultMakeId = () => `${crypto.randomUUID()}`;

/// Duplicating a built-in yields an unsaved draft, never a library entry: the design routes all
/// edits of a built-in through Duplicate -> Save as.
export function duplicateAsDraft(builtinId, makeId = defaultMakeId) {
  const source = BUILTIN_BY_ID.get(builtinId);
  if (!source) return null;
  const clone = structuredClone(source);
  return {
    ...clone,
    id: makeId(),
    name: `${source.name} (copy)`,
    kind: "draft",
    basedOn: source.id,
  };
}

/// Sets a document's reference. Reference is decoupled from judgement now -- it only draws the
/// guide line -- so this writes nothing but the field.
export function withReferenceLufs(document, referenceLufs) {
  if (!document) return document;
  return { ...document, referenceLufs };
}

/// The metrics a profile actually judges: those carrying at least one filled-in rule, in first-seen
/// order. This is the "watched" set the label highlight, missing-stats and footer read off.
export function watchedMetricIds(document) {
  const seen = [];
  const set = new Set();
  for (const r of document?.rules ?? []) {
    if (isRuleEmpty(r) || set.has(r.metricId)) continue;
    set.add(r.metricId);
    seen.push(r.metricId);
  }
  return seen;
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
/// Null covers Off and a `user:<id>` that is no longer in the library (a preset can outlive the
/// profile it referenced).
export function resolveActiveDocument(state) {
  const { kind, id } = parseSelection(state?.active);
  if (kind === "off") return null;
  if (kind === "builtin") return BUILTIN_BY_ID.get(id) ?? null;
  return (state?.userProfiles ?? []).find((p) => p.id === id) ?? null;
}

/// Every metric a rule can address must be a real Stats row, otherwise the rule is unreachable
/// and "missing stats" could never be satisfied.
export function isKnownMetricId(metricId) {
  return Object.hasOwn(STATS_META, metricId) && RULEABLE_METRIC_SET.has(metricId);
}

/// A number somebody actually typed: the one test every threshold has to pass.
///
/// Strict about the type, not just the value. An untouched form field is `""` and a cleared one
/// arrives as `null`; `Number` reads both as a perfectly good 0, so a coercing check turns a blank
/// box into a threshold nobody chose.
export function isUsableThreshold(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/// A rule the user has added but not filled in. It judges nothing and has to survive a round-trip:
/// the alternative is a row that vanishes when the panel closes.
export function isRuleEmpty(rule) {
  return !rule || !isUsableThreshold(rule.value);
}
