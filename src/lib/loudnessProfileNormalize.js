/// Normalizes the persisted `loudnessProfiles` blob in `plvs:settings`.
///
/// Everything here guards data that has been on disk across releases, so every field degrades to
/// a default rather than throwing: a corrupt profile must cost the user that profile, not the
/// ability to start the app. Cold default is Off (see the design doc, §Active selection).

import {
  BUILTIN_LOUDNESS_PROFILES,
  LOUDNESS_PROFILE_OFF,
  isKnownMetricId,
  isUsableThreshold,
  parseSelection,
} from "./loudnessProfileCatalog.js";

const VALID_OPS = new Set([">", "<"]);
const BUILTIN_IDS = new Set(BUILTIN_LOUDNESS_PROFILES.map((p) => p.id));

export const DEFAULT_LOUDNESS_PROFILES = Object.freeze({
  active: LOUDNESS_PROFILE_OFF,
  userProfiles: [],
});

function normalizeReference(raw) {
  // `isUsableThreshold` rather than `Number`: `Number("")` is a perfectly good 0, which would draw
  // a reference line at 0 LUFS that nobody asked for.
  if (!isUsableThreshold(raw)) return null;
  // Same window the legacy reference input accepted.
  return raw >= -70 && raw <= 0 ? raw : null;
}

function normalizeSeverity(raw) {
  return raw === "fail" ? "fail" : "warn";
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!isKnownMetricId(raw.metricId)) return null;
  if (!VALID_OPS.has(raw.op)) return null;

  const rule = { metricId: raw.metricId, op: raw.op, severity: normalizeSeverity(raw.severity) };
  // The value goes through `isUsableThreshold`, never `Number`: a blank field is `null` or `""`,
  // both of which coerce to a perfectly good 0, and persisting that invents a threshold nobody
  // chose. A rule with no usable value survives as an empty (unfilled) row.
  if (isUsableThreshold(raw.value)) rule.value = raw.value;
  return rule;
}

/// A rule document survives with whatever rules are still valid; rules on unknown metric ids are
/// dropped so a profile written by a newer build cannot address rows this build cannot show.
export function normalizeRuleDocument(raw, { kind } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const rules = [];
  for (const rawRule of Array.isArray(raw.rules) ? raw.rules : []) {
    const rule = normalizeRule(rawRule);
    if (rule) rules.push(rule);
  }

  const document = {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Untitled",
    kind: kind ?? (raw.kind === "draft" ? "draft" : "user"),
    referenceLufs: normalizeReference(raw.referenceLufs),
    rules,
  };

  if (typeof raw.basedOn === "string" && raw.basedOn.length > 0) document.basedOn = raw.basedOn;

  return document;
}

/// Resolves the persisted selection, falling back to Off whenever it cannot be honoured: an
/// unknown built-in, or a user profile that has been deleted.
function normalizeActive(raw, { userProfiles }) {
  const { kind, id } = parseSelection(raw);
  if (kind === "off") return LOUDNESS_PROFILE_OFF;
  if (kind === "builtin") return BUILTIN_IDS.has(id) ? raw : LOUDNESS_PROFILE_OFF;
  return userProfiles.some((p) => p.id === id) ? raw : LOUDNESS_PROFILE_OFF;
}

export function normalizeLoudnessProfiles(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ...DEFAULT_LOUDNESS_PROFILES };

  const seenIds = new Set();
  const userProfiles = (Array.isArray(raw.userProfiles) ? raw.userProfiles : [])
    .map((entry) => normalizeRuleDocument(entry, { kind: "user" }))
    .filter((profile) => {
      if (!profile || seenIds.has(profile.id)) return false;
      seenIds.add(profile.id);
      return true;
    });

  return {
    active: normalizeActive(raw.active, { userProfiles }),
    userProfiles,
  };
}
