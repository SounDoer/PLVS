/// Normalizes the persisted `loudnessProfiles` blob in `plvs:settings`.
///
/// Everything here guards data that has been on disk across releases, so every field degrades to
/// a default rather than throwing: a corrupt profile must cost the user that profile, not the
/// ability to start the app. Cold default is Off (see the design doc, §Active selection).

import {
  LOUDNESS_PROFILE_OFF,
  createStarterProfile,
  isKnownMetricId,
  isUsableThreshold,
  parseSelection,
} from "./loudnessProfileCatalog.js";

const VALID_OPS = new Set([">", "<"]);

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
export function normalizeRuleDocument(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const rules = [];
  for (const rawRule of Array.isArray(raw.rules) ? raw.rules : []) {
    const rule = normalizeRule(rawRule);
    if (rule) rules.push(rule);
  }

  const document = {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name : "Untitled",
    referenceLufs: normalizeReference(raw.referenceLufs),
    rules,
  };

  return document;
}

/// Resolves the persisted selection, falling back to Off whenever the selected profile is absent.
function normalizeActive(raw, profiles) {
  const { kind, id } = parseSelection(raw);
  if (kind !== "profile") return LOUDNESS_PROFILE_OFF;
  return profiles.some((profile) => profile.id === id) ? raw : LOUDNESS_PROFILE_OFF;
}

export function normalizeLoudnessProfiles(raw, { makeId } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.profiles)) {
    return { active: LOUDNESS_PROFILE_OFF, profiles: [createStarterProfile(makeId)] };
  }

  const seenIds = new Set();
  const profiles = raw.profiles
    .map((entry) => normalizeRuleDocument(entry))
    .filter((profile) => {
      if (!profile || seenIds.has(profile.id)) return false;
      seenIds.add(profile.id);
      return true;
    });

  return {
    active: normalizeActive(raw.active, profiles),
    profiles,
  };
}
