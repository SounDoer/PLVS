/// Normalizes the persisted `loudnessProfiles` blob in `plvs:settings`.
///
/// Everything here guards data that has been on disk across releases, so every field degrades to
/// a default rather than throwing: a corrupt profile must cost the user that profile, not the
/// ability to start the app. Cold default is Off (see the design doc, §Active selection).

import {
  BUILTIN_LOUDNESS_PROFILES,
  LOUDNESS_PROFILE_CUSTOM,
  LOUDNESS_PROFILE_OFF,
  isKnownMetricId,
  parseSelection,
} from "./loudnessProfileCatalog.js";

const VALID_ROLES = new Set(["target", "limit", "descriptor", "na"]);
const BUILTIN_IDS = new Set(BUILTIN_LOUDNESS_PROFILES.map((p) => p.id));

export const DEFAULT_LOUDNESS_PROFILES = Object.freeze({
  active: LOUDNESS_PROFILE_OFF,
  customDraft: null,
  userProfiles: [],
});

function normalizeReference(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  // Same window the legacy reference input accepted.
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : null;
}

function normalizeTolerance(raw) {
  const minus = Number(raw?.minus);
  const plus = Number(raw?.plus);
  if (!Number.isFinite(minus) || !Number.isFinite(plus)) return null;
  if (minus < 0 || plus < 0) return null;
  return { minus, plus };
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!VALID_ROLES.has(raw.role)) return null;

  const rule = {
    role: raw.role,
    severity: raw.severity === "fail" ? "fail" : "warn",
  };

  if (raw.role === "target") {
    const target = Number(raw.target);
    // A target always carries a band so evaluation never has to guess one. Without a target
    // there is nothing to band, and the rule stays empty until the user fills it in.
    if (Number.isFinite(target)) {
      rule.target = target;
      rule.tolerance = normalizeTolerance(raw.tolerance) ?? { minus: 0, plus: 0 };
    }
  }

  if (raw.role === "limit") {
    if (Number.isFinite(Number(raw.max))) rule.max = Number(raw.max);
    if (Number.isFinite(Number(raw.min))) rule.min = Number(raw.min);
  }

  if (raw.provisional === true) rule.provisional = true;
  if (Number.isFinite(Number(raw.requiresDialogueCoverage))) {
    rule.requiresDialogueCoverage = Number(raw.requiresDialogueCoverage);
  }

  return rule;
}

/// A rule document survives with whatever rules are still valid; unknown metric ids are dropped
/// so a profile written by a newer build cannot address rows this build cannot show.
export function normalizeRuleDocument(raw, { kind } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const metrics = {};
  for (const [metricId, rawRule] of Object.entries(raw.metrics ?? {})) {
    if (!isKnownMetricId(metricId)) continue;
    const rule = normalizeRule(rawRule);
    if (rule) metrics[metricId] = rule;
  }

  // Preferring a metric with no surviving rule would strand "missing stats": the row could be
  // demanded but never judged.
  const preferredMetricIds = (Array.isArray(raw.preferredMetricIds) ? raw.preferredMetricIds : [])
    .filter((id) => Object.hasOwn(metrics, id))
    .filter((id, index, all) => all.indexOf(id) === index);

  const document = {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Untitled",
    kind: kind ?? (raw.kind === "draft" ? "draft" : "user"),
    referenceLufs: normalizeReference(raw.referenceLufs),
    metrics,
    preferredMetricIds,
  };

  if (typeof raw.basedOn === "string" && raw.basedOn.length > 0) document.basedOn = raw.basedOn;

  return document;
}

/// Resolves the persisted selection, falling back to Off whenever it cannot be honoured: an
/// unknown built-in, a user profile that has been deleted, or Custom with no draft behind it.
function normalizeActive(raw, { customDraft, userProfiles }) {
  const { kind, id } = parseSelection(raw);
  if (kind === "off") return LOUDNESS_PROFILE_OFF;
  if (kind === "draft") return customDraft ? LOUDNESS_PROFILE_CUSTOM : LOUDNESS_PROFILE_OFF;
  if (kind === "builtin") return BUILTIN_IDS.has(id) ? raw : LOUDNESS_PROFILE_OFF;
  return userProfiles.some((p) => p.id === id) ? raw : LOUDNESS_PROFILE_OFF;
}

export function normalizeLoudnessProfiles(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ...DEFAULT_LOUDNESS_PROFILES };

  const customDraft = normalizeRuleDocument(raw.customDraft, { kind: "draft" });

  const seenIds = new Set();
  const userProfiles = (Array.isArray(raw.userProfiles) ? raw.userProfiles : [])
    .map((entry) => normalizeRuleDocument(entry, { kind: "user" }))
    .filter((profile) => {
      if (!profile || seenIds.has(profile.id)) return false;
      seenIds.add(profile.id);
      return true;
    });

  return {
    active: normalizeActive(raw.active, { customDraft, userProfiles }),
    customDraft,
    userProfiles,
  };
}
