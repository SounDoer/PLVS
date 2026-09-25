export const PACK_V2_VERSION = 2;
export const MAX_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_PACK_DEPTH = 32;
export const MAX_PACK_ITEMS = 256;
export const MAX_PACK_DEPENDENCY_GROUPS = 1;
export const MAX_PACK_DEPENDENCY_ITEMS = 256;

const PACK_V2_FIELDS = new Set(["app", "kind", "version", "createdWith", "items", "dependencies"]);
const PORTABLE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_ITEM_IDS = new Set(["__proto__", "prototype", "constructor"]);

export function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function packIssue(code, path, message, details) {
  return {
    severity: "error",
    code,
    path,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

export function prefixPackIssues(issues, prefix) {
  return issues.map((entry) => ({
    severity: entry.severity ?? "error",
    ...entry,
    path: entry.path === "$" ? prefix : `${prefix}${entry.path.slice(1)}`,
  }));
}

export function normalizePortableItemId(value) {
  if (typeof value !== "string" || !PORTABLE_ITEM_ID.test(value)) return null;
  return RESERVED_ITEM_IDS.has(value) ? null : value;
}

function encodedByteLength(raw) {
  try {
    return new TextEncoder().encode(JSON.stringify(raw)).byteLength;
  } catch (_) {
    return null;
  }
}

function exceedsDepthLimit(raw) {
  const pending = [{ value: raw, depth: 1 }];
  const seen = new WeakSet();
  while (pending.length > 0) {
    const { value, depth } = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (depth > MAX_PACK_DEPTH) return true;
    if (seen.has(value)) continue;
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) pending.push({ value: child, depth: depth + 1 });
  }
  return false;
}

/** Resource checks shared by legacy and strict Pack parsing. */
export function collectPackResourceIssues(raw) {
  const issues = [];
  const byteLength = encodedByteLength(raw);
  if (byteLength === null) {
    issues.push(packIssue("invalidJsonValue", "$", "The Pack must contain serializable JSON."));
  } else if (byteLength > MAX_PACK_BYTES) {
    issues.push(
      packIssue("packTooLarge", "$", `The Pack exceeds the ${MAX_PACK_BYTES}-byte limit.`, {
        byteLength,
        limit: MAX_PACK_BYTES,
      })
    );
  }
  if (exceedsDepthLimit(raw)) {
    issues.push(
      packIssue("packTooDeep", "$", `The Pack exceeds the depth limit of ${MAX_PACK_DEPTH}.`, {
        limit: MAX_PACK_DEPTH,
      })
    );
  }
  return issues;
}

/** Strictly validates the family-neutral part of a Pack V2 envelope. */
export function collectPackV2EnvelopeIssues(raw, { allowedDependencyKind = null } = {}) {
  const issues = [...collectPackResourceIssues(raw)];
  for (const field of Object.keys(raw)) {
    if (!PACK_V2_FIELDS.has(field)) {
      issues.push(packIssue("unknownField", `$.${field}`, `Unknown field: ${field}.`));
    }
  }

  if ("createdWith" in raw) {
    if (!isObjectRecord(raw.createdWith)) {
      issues.push(
        packIssue("invalidCreatedWith", "$.createdWith", "createdWith must be an object.")
      );
    } else {
      for (const field of Object.keys(raw.createdWith)) {
        if (field !== "appVersion") {
          issues.push(
            packIssue("unknownField", `$.createdWith.${field}`, `Unknown field: ${field}.`)
          );
        }
      }
      if (
        "appVersion" in raw.createdWith &&
        (typeof raw.createdWith.appVersion !== "string" || raw.createdWith.appVersion.length === 0)
      ) {
        issues.push(
          packIssue(
            "invalidAppVersion",
            "$.createdWith.appVersion",
            "appVersion must be a non-empty string."
          )
        );
      }
    }
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    issues.push(packIssue("invalidItems", "$.items", "items must be a non-empty array."));
  } else if (raw.items.length > MAX_PACK_ITEMS) {
    issues.push(
      packIssue(
        "tooManyItems",
        "$.items",
        `items must contain at most ${MAX_PACK_ITEMS} entries.`,
        {
          count: raw.items.length,
          limit: MAX_PACK_ITEMS,
        }
      )
    );
  }

  if (!Array.isArray(raw.dependencies)) {
    issues.push(
      packIssue("invalidDependencies", "$.dependencies", "dependencies must be an array.")
    );
  } else {
    if (raw.dependencies.length > MAX_PACK_DEPENDENCY_GROUPS) {
      issues.push(
        packIssue(
          "tooManyDependencyGroups",
          "$.dependencies",
          `dependencies must contain at most ${MAX_PACK_DEPENDENCY_GROUPS} group.`,
          { count: raw.dependencies.length, limit: MAX_PACK_DEPENDENCY_GROUPS }
        )
      );
    }
    if (allowedDependencyKind === null && raw.dependencies.length > 0) {
      issues.push(
        packIssue("unsupportedDependency", "$.dependencies", "This pack kind has no dependencies.")
      );
    }
  }
  return issues;
}

/**
 * Validates IDs and converts every primary Item while aggregating all detectable issues.
 */
export function parsePackV2Items(
  raw,
  { entryLabel, invalidEntryCode, invalidIdCode, duplicateIdCode, convert }
) {
  if (!Array.isArray(raw.items)) return { items: [], issues: [] };
  const issues = [];
  const seenIds = new Set();
  const items = [];
  raw.items.forEach((item, index) => {
    const path = `$.items[${index}]`;
    if (!isObjectRecord(item)) {
      issues.push(packIssue(invalidEntryCode, path, `A ${entryLabel} entry must be an object.`));
      return;
    }
    const { id: rawId, ...document } = item;
    const id = normalizePortableItemId(rawId);
    if (!id) {
      issues.push(packIssue(invalidIdCode, `${path}.id`, "id is invalid."));
      return;
    }
    if (seenIds.has(id)) {
      issues.push(packIssue(duplicateIdCode, `${path}.id`, `Duplicate id: ${id}.`));
    } else {
      seenIds.add(id);
    }
    try {
      items.push(convert(document, id));
    } catch (error) {
      if (!Array.isArray(error?.issues)) throw error;
      issues.push(...prefixPackIssues(error.issues, path));
    }
  });
  return { items, issues };
}
