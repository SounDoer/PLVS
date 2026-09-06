import {
  LOUDNESS_PROFILE_OFF,
  isKnownMetricId,
  profileSelectionId,
} from "./loudnessProfileCatalog.js";
import { normalizeRuleDocument } from "./loudnessProfileNormalize.js";

const DOCUMENT_FIELDS = new Set(["name", "referenceLufs", "rules"]);
const RULE_FIELDS = new Set(["metricId", "op", "value", "severity"]);
const VALID_OPERATORS = new Set([">", "<"]);
const VALID_SEVERITIES = new Set(["warn", "fail"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message) {
  return { code, path, message };
}

export class LoudnessProfileDocumentError extends Error {
  constructor(issues) {
    super("The Loudness Profile document is invalid.");
    this.name = "LoudnessProfileDocumentError";
    this.code = "invalidProfile";
    this.issues = issues;
  }
}

function validateRule(raw, index, issues) {
  const path = `$.rules[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push(issue("invalidRule", path, "A rule must be a plain object."));
    return;
  }

  for (const field of Object.keys(raw)) {
    if (!RULE_FIELDS.has(field)) {
      issues.push(issue("unknownField", `${path}.${field}`, `Unknown rule field: ${field}.`));
    }
  }
  if (!isKnownMetricId(raw.metricId)) {
    issues.push(
      issue("unknownMetric", `${path}.metricId`, "metricId must name a ruleable Stats metric.")
    );
  }
  if (!VALID_OPERATORS.has(raw.op)) {
    issues.push(issue("invalidOperator", `${path}.op`, 'op must be ">" or "<".'));
  }
  if (Object.hasOwn(raw, "value") && !Number.isFinite(raw.value)) {
    issues.push(
      issue("invalidNumber", `${path}.value`, "value must be a finite number when present.")
    );
  }
  if (!VALID_SEVERITIES.has(raw.severity)) {
    issues.push(issue("invalidSeverity", `${path}.severity`, 'severity must be "warn" or "fail".'));
  }
}

/**
 * Strictly validates an id-free public authoring document, then passes it through the same
 * normalizer used by editor preview and persistence. Returns a normalized, id-free clone.
 */
export function validateLoudnessProfileDocument(raw) {
  if (!isPlainObject(raw)) {
    throw new LoudnessProfileDocumentError([
      issue("invalidDocument", "$", "A Loudness Profile document must be a plain object."),
    ]);
  }

  const issues = [];
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    issues.push(issue("invalidName", "$.name", "name must contain non-whitespace text."));
  }
  if (
    raw.referenceLufs !== null &&
    (typeof raw.referenceLufs !== "number" || !Number.isFinite(raw.referenceLufs))
  ) {
    issues.push(
      issue("invalidNumber", "$.referenceLufs", "referenceLufs must be null or a finite number.")
    );
  } else if (raw.referenceLufs !== null && (raw.referenceLufs < -70 || raw.referenceLufs > 0)) {
    issues.push(
      issue("outOfRange", "$.referenceLufs", "referenceLufs must be from -70 through 0.")
    );
  }
  if (!Array.isArray(raw.rules)) {
    issues.push(issue("invalidRules", "$.rules", "rules must be an array."));
  } else {
    raw.rules.forEach((rule, index) => validateRule(rule, index, issues));
  }
  for (const field of Object.keys(raw)) {
    if (!DOCUMENT_FIELDS.has(field)) {
      issues.push(issue("unknownField", `$.${field}`, `Unknown document field: ${field}.`));
    }
  }
  if (issues.length > 0) throw new LoudnessProfileDocumentError(issues);

  const normalized = normalizeRuleDocument({ ...raw, name: raw.name.trim(), id: "authoring" });
  const { id: _id, ...document } = normalized;
  return document;
}

function invalid(loudnessProfiles, presets, issues) {
  return { loudnessProfiles, presets, changed: [], warnings: [], issues };
}

function notFound(loudnessProfiles, presets, profileId) {
  return invalid(loudnessProfiles, presets, [
    issue("loudnessProfileNotFound", "$.profileId", `Loudness Profile ${profileId} was not found.`),
  ]);
}

function validatedPlan(loudnessProfiles, presets, rawDocument, build) {
  try {
    return build(validateLoudnessProfileDocument(rawDocument));
  } catch (error) {
    if (!(error instanceof LoudnessProfileDocumentError)) throw error;
    return invalid(loudnessProfiles, presets, error.issues);
  }
}

function withDirtyPreset(presets, selectionChanged) {
  if (!selectionChanged || presets?.activeId == null || presets.dirty === true) return presets;
  return { ...presets, dirty: true };
}

function profileIdFromSelection(selection) {
  return selection === LOUDNESS_PROFILE_OFF ? null : selection;
}

export function planLoudnessProfileSelect(loudnessProfiles, presets, selection) {
  const profileId = profileIdFromSelection(selection);
  if (profileId !== null && !loudnessProfiles.profiles.some(({ id }) => id === profileId)) {
    return notFound(loudnessProfiles, presets, profileId);
  }
  const nextActive = profileId === null ? LOUDNESS_PROFILE_OFF : profileSelectionId(profileId);
  const selectionChanged = nextActive !== loudnessProfiles.active;
  if (!selectionChanged) {
    return {
      ...invalid(loudnessProfiles, presets, []),
      from: profileId,
      to: profileId,
    };
  }
  const nextPresets = withDirtyPreset(presets, true);
  return {
    loudnessProfiles: { ...loudnessProfiles, active: nextActive },
    presets: nextPresets,
    changed: ["loudnessProfiles.active", ...(nextPresets !== presets ? ["presets.dirty"] : [])],
    warnings: [],
    issues: [],
    from:
      loudnessProfiles.active === LOUDNESS_PROFILE_OFF
        ? null
        : loudnessProfiles.active.slice("profile:".length),
    to: profileId,
  };
}

export function planLoudnessProfileCreate(loudnessProfiles, presets, rawDocument, { makeId } = {}) {
  return validatedPlan(loudnessProfiles, presets, rawDocument, (document) => {
    if (typeof makeId !== "function") {
      return {
        ...invalid(loudnessProfiles, presets, []),
        changed: ["loudnessProfiles.library", "loudnessProfiles.active"],
        document,
        selectCreated: true,
      };
    }
    const id = makeId();
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      loudnessProfiles.profiles.some((profile) => profile.id === id)
    ) {
      return invalid(loudnessProfiles, presets, [
        issue("duplicateProfileId", "$.profile.id", "The generated Profile ID is not unique."),
      ]);
    }
    const profile = { id, ...document };
    const nextPresets = withDirtyPreset(presets, true);
    return {
      loudnessProfiles: {
        active: profileSelectionId(id),
        profiles: [...loudnessProfiles.profiles, profile],
      },
      presets: nextPresets,
      changed: [
        "loudnessProfiles.library",
        "loudnessProfiles.active",
        ...(nextPresets !== presets ? ["presets.dirty"] : []),
      ],
      warnings: [],
      issues: [],
      document,
      selectCreated: true,
      profile,
    };
  });
}

export function planLoudnessProfileUpdate(loudnessProfiles, profileId, rawDocument) {
  const existing = loudnessProfiles.profiles.find(({ id }) => id === profileId);
  if (!existing) return notFound(loudnessProfiles, undefined, profileId);
  return validatedPlan(loudnessProfiles, undefined, rawDocument, (document) => {
    const profile = { id: profileId, ...document };
    if (JSON.stringify(profile) === JSON.stringify(existing)) {
      return { ...invalid(loudnessProfiles, undefined, []), profile };
    }
    return {
      loudnessProfiles: {
        ...loudnessProfiles,
        profiles: loudnessProfiles.profiles.map((item) => (item.id === profileId ? profile : item)),
      },
      changed: [`loudnessProfiles.${profileId}.document`],
      warnings: [],
      issues: [],
      profile,
    };
  });
}

export function planLoudnessProfileRename(loudnessProfiles, profileId, name) {
  const existing = loudnessProfiles.profiles.find(({ id }) => id === profileId);
  if (!existing) return notFound(loudnessProfiles, undefined, profileId);
  if (typeof name !== "string" || name.trim() === "") {
    return invalid(loudnessProfiles, undefined, [
      issue("invalidName", "$.name", "name must contain non-whitespace text."),
    ]);
  }
  const trimmed = name.trim();
  if (trimmed === existing.name) {
    return { ...invalid(loudnessProfiles, undefined, []), profile: existing };
  }
  const profile = { ...existing, name: trimmed };
  return {
    loudnessProfiles: {
      ...loudnessProfiles,
      profiles: loudnessProfiles.profiles.map((item) => (item.id === profileId ? profile : item)),
    },
    changed: [`loudnessProfiles.${profileId}.name`],
    warnings: [],
    issues: [],
    profile,
  };
}

export function planLoudnessProfileDelete(loudnessProfiles, presets, profileId) {
  const existing = loudnessProfiles.profiles.find(({ id }) => id === profileId);
  if (!existing) return notFound(loudnessProfiles, presets, profileId);
  const selection = profileSelectionId(profileId);
  const selectionFallsBackToOff = loudnessProfiles.active === selection;
  const affectedPresetIds = [];
  const nextList = presets.list.map((preset) => {
    if (preset?.loudnessProfileActive !== selection) return preset;
    affectedPresetIds.push(preset.id);
    return { ...preset, loudnessProfileActive: LOUDNESS_PROFILE_OFF };
  });
  const nextPresets = {
    ...presets,
    ...(affectedPresetIds.length > 0 ? { list: nextList } : {}),
    ...(selectionFallsBackToOff && presets.activeId != null ? { dirty: true } : {}),
  };
  return {
    loudnessProfiles: {
      active: selectionFallsBackToOff ? LOUDNESS_PROFILE_OFF : loudnessProfiles.active,
      profiles: loudnessProfiles.profiles.filter(({ id }) => id !== profileId),
    },
    presets:
      affectedPresetIds.length > 0 ||
      (selectionFallsBackToOff && presets.activeId != null && presets.dirty !== true)
        ? nextPresets
        : presets,
    changed: [
      "loudnessProfiles.library",
      ...(selectionFallsBackToOff ? ["loudnessProfiles.active"] : []),
      ...affectedPresetIds.map((id) => `presets.${id}.loudnessProfileActive`),
      ...(selectionFallsBackToOff && presets.activeId != null && presets.dirty !== true
        ? ["presets.dirty"]
        : []),
    ],
    warnings: [],
    issues: [],
    deletedProfile: existing,
    selectionFallsBackToOff,
    affectedPresetIds,
  };
}

export function planLoudnessProfileReorder(loudnessProfiles, profileIds) {
  const currentIds = loudnessProfiles.profiles.map(({ id }) => id);
  const valid =
    Array.isArray(profileIds) &&
    profileIds.length === currentIds.length &&
    profileIds.every((id) => typeof id === "string") &&
    new Set(profileIds).size === profileIds.length &&
    profileIds.every((id) => currentIds.includes(id));
  if (!valid) {
    return invalid(loudnessProfiles, undefined, [
      issue(
        "invalidPermutation",
        "$.profileIds",
        "profileIds must contain every current Loudness Profile ID exactly once."
      ),
    ]);
  }
  if (profileIds.every((id, index) => id === currentIds[index])) {
    return { ...invalid(loudnessProfiles, undefined, []), profileIds: currentIds };
  }
  const byId = new Map(loudnessProfiles.profiles.map((profile) => [profile.id, profile]));
  return {
    loudnessProfiles: { ...loudnessProfiles, profiles: profileIds.map((id) => byId.get(id)) },
    changed: ["loudnessProfiles.order"],
    warnings: [],
    issues: [],
    profileIds: [...profileIds],
  };
}
