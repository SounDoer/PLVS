import {
  validateLoudnessProfileDocument,
  LoudnessProfileDocumentError,
} from "./loudnessProfileLibrary.js";

export const PORTABLE_LOUDNESS_PROFILE_KIND = "plvs-loudness-profile";
export const PORTABLE_LOUDNESS_PROFILE_FORMAT_VERSION = 1;
export const PORTABLE_LOUDNESS_PROFILE_SEMANTICS_VERSION = 1;
export const MAX_PORTABLE_LOUDNESS_PROFILE_NAME_LENGTH = 64;
export const MAX_PORTABLE_LOUDNESS_PROFILE_RULES = 128;

const PORTABLE_FIELDS = new Set([
  "kind",
  "formatVersion",
  "semanticsVersion",
  "name",
  "referenceLufs",
  "rules",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message) {
  return { code, path, message };
}

export class PortableLoudnessProfileError extends Error {
  constructor(issues) {
    super("The portable Loudness Profile document is invalid.");
    this.name = "PortableLoudnessProfileError";
    this.code = "invalidPortableLoudnessProfile";
    this.issues = issues;
  }
}

function portableFromAuthoring(document) {
  return {
    kind: PORTABLE_LOUDNESS_PROFILE_KIND,
    formatVersion: PORTABLE_LOUDNESS_PROFILE_FORMAT_VERSION,
    semanticsVersion: PORTABLE_LOUDNESS_PROFILE_SEMANTICS_VERSION,
    name: document.name,
    referenceLufs: document.referenceLufs,
    rules: document.rules.map(({ metricId, op, value, severity }) => ({
      metricId,
      op,
      value,
      severity,
    })),
  };
}

/** Strictly validates and canonicalizes an id-free portable Loudness Profile. */
export function validatePortableLoudnessProfile(raw) {
  if (!isPlainObject(raw)) {
    throw new PortableLoudnessProfileError([
      issue("invalidDocument", "$", "A portable Loudness Profile must be a plain object."),
    ]);
  }

  const issues = [];
  for (const field of Object.keys(raw)) {
    if (!PORTABLE_FIELDS.has(field)) {
      issues.push(issue("unknownField", `$.${field}`, `Unknown field: ${field}.`));
    }
  }
  if (raw.kind !== PORTABLE_LOUDNESS_PROFILE_KIND) {
    issues.push(
      issue(
        "invalidKind",
        "$.kind",
        `kind must be ${JSON.stringify(PORTABLE_LOUDNESS_PROFILE_KIND)}.`
      )
    );
  }
  if (raw.formatVersion !== PORTABLE_LOUDNESS_PROFILE_FORMAT_VERSION) {
    issues.push(
      issue(
        "unsupportedFormatVersion",
        "$.formatVersion",
        `formatVersion must be ${PORTABLE_LOUDNESS_PROFILE_FORMAT_VERSION}.`
      )
    );
  }
  if (raw.semanticsVersion !== PORTABLE_LOUDNESS_PROFILE_SEMANTICS_VERSION) {
    issues.push(
      issue(
        "unsupportedSemanticsVersion",
        "$.semanticsVersion",
        `semanticsVersion must be ${PORTABLE_LOUDNESS_PROFILE_SEMANTICS_VERSION}.`
      )
    );
  }

  let authoring;
  try {
    authoring = validateLoudnessProfileDocument({
      name: raw.name,
      referenceLufs: raw.referenceLufs,
      rules: raw.rules,
    });
  } catch (error) {
    if (error instanceof LoudnessProfileDocumentError) issues.push(...error.issues);
    else throw error;
  }

  if (
    typeof raw.name === "string" &&
    Array.from(raw.name.trim()).length > MAX_PORTABLE_LOUDNESS_PROFILE_NAME_LENGTH
  ) {
    issues.push(
      issue(
        "nameTooLong",
        "$.name",
        `name must contain at most ${MAX_PORTABLE_LOUDNESS_PROFILE_NAME_LENGTH} characters.`
      )
    );
  }
  if (Array.isArray(raw.rules)) {
    if (raw.rules.length > MAX_PORTABLE_LOUDNESS_PROFILE_RULES) {
      issues.push(
        issue(
          "tooManyRules",
          "$.rules",
          `rules must contain at most ${MAX_PORTABLE_LOUDNESS_PROFILE_RULES} entries.`
        )
      );
    }
    raw.rules.forEach((rule, index) => {
      if (isPlainObject(rule) && !Number.isFinite(rule.value)) {
        issues.push(
          issue(
            "incompleteRule",
            `$.rules[${index}].value`,
            "Every published rule must have a finite threshold value."
          )
        );
      }
    });
  }
  if (raw.referenceLufs === null && Array.isArray(raw.rules) && raw.rules.length === 0) {
    issues.push(
      issue(
        "emptyProfile",
        "$",
        "A portable Loudness Profile needs a reference or at least one complete rule."
      )
    );
  }

  if (issues.length > 0) throw new PortableLoudnessProfileError(issues);
  return portableFromAuthoring(authoring);
}

/** Converts a readable stored Profile into its stable, id-free portable document. */
export function loudnessProfileToPortable(raw) {
  if (!isPlainObject(raw)) {
    throw new PortableLoudnessProfileError([
      issue("invalidProfile", "$", "The stored Loudness Profile cannot be read."),
    ]);
  }
  const { id: _id, ...authoring } = raw;
  let validated;
  try {
    validated = validateLoudnessProfileDocument(authoring);
  } catch (error) {
    if (!(error instanceof LoudnessProfileDocumentError)) throw error;
    throw new PortableLoudnessProfileError(error.issues);
  }
  return validatePortableLoudnessProfile(portableFromAuthoring(validated));
}

/** Converts a portable document into the current stored shape using a caller-owned local ID. */
export function portableToStoredLoudnessProfile(raw, id) {
  if (typeof id !== "string" || id.length === 0) {
    throw new PortableLoudnessProfileError([
      issue("invalidProfileId", "$.id", "The destination Loudness Profile ID is invalid."),
    ]);
  }
  const portable = validatePortableLoudnessProfile(raw);
  return {
    id,
    name: portable.name,
    referenceLufs: portable.referenceLufs,
    rules: portable.rules.map((rule) => ({ ...rule })),
  };
}
