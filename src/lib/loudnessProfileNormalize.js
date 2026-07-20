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
  isUsableTolerance,
  parseSelection,
} from "./loudnessProfileCatalog.js";

const VALID_ROLES = new Set(["target", "limit", "descriptor", "na"]);
const BUILTIN_IDS = new Set(BUILTIN_LOUDNESS_PROFILES.map((p) => p.id));

export const DEFAULT_LOUDNESS_PROFILES = Object.freeze({
  active: LOUDNESS_PROFILE_OFF,
  userProfiles: [],
});

function normalizeReference(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  // Same window the legacy reference input accepted.
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : null;
}

function normalizeTolerance(raw) {
  if (!isUsableTolerance(raw)) return null;
  return { minus: Number(raw.minus), plus: Number(raw.plus) };
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!VALID_ROLES.has(raw.role)) return null;

  const rule = {
    role: raw.role,
    severity: raw.severity === "fail" ? "fail" : "warn",
  };

  // Every threshold goes through `isUsableThreshold`, never `Number`: a blank field is `null` or
  // `""`, both of which coerce to a perfectly good 0, and persisting that 0 invents a delivery
  // number the user never chose. Blank means "not judged".
  if (raw.role === "target") {
    // Each half is kept only if usable, and `isRuleEmpty` treats a rule missing either half as
    // unfilled. A corrupt band therefore degrades to "not judged" rather than to the harshest
    // possible judgement.
    if (isUsableThreshold(raw.target)) rule.target = raw.target;
    const tolerance = normalizeTolerance(raw.tolerance);
    if (tolerance) rule.tolerance = tolerance;
  }

  if (raw.role === "limit") {
    if (isUsableThreshold(raw.max)) rule.max = raw.max;
    if (isUsableThreshold(raw.min)) rule.min = raw.min;
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

  // A rule addressing an unknown metric is dropped above, and its preferred id goes with it.
  // An empty rule is the deliberate exception: it survives, and stays preferred, because the row
  // being filled in is the point.
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
/// unknown built-in, or a user profile that has been deleted. A selection written by an older
/// build -- `unsaved-custom` -- parses as unknown and lands here as Off, which is the migration.
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
