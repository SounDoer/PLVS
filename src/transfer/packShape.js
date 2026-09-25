/// The pack file format: three kinds, one envelope. The only module that knows what a pack file
/// looks like on disk. Modelled on `src/persistence/profileShape.js`, which does the same job for
/// the whole-configuration `.plvsconfig` file.
///
/// A pack is a *sharing* artefact, not a backup: import merges it into the recipient's library and
/// never overwrites anything, so nothing here needs to describe removal or selection state.

import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import {
  PortableLoudnessProfileError,
  loudnessProfileToPortable,
  portableToStoredLoudnessProfile,
} from "../lib/portableLoudnessProfile.js";
import { normalizeThemeDocument } from "../theme/migrations/migrateV1Theme.js";
import {
  PORTABLE_THEME_FORMAT_VERSION,
  PORTABLE_THEME_KIND,
  PORTABLE_THEME_SEMANTICS_VERSION,
  PortableThemeError,
  portableToStoredTheme,
  themeToPortable,
} from "../theme/portableTheme.js";
import { normalizeThemeId } from "../theme/themeSchema.js";
// `panelInstances.js` imports `moduleCatalog.js` only. Never reach `workspace/registry.jsx` from
// here -- it evaluates every canvas panel and costs about two seconds per import.
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

export const PACK_APP = "PLVS";
export const PACK_VERSION = 1;
export const LOUDNESS_PACK_VERSION = 2;
export const THEME_PACK_VERSION = 2;

function normalizePresetEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) return null;
  if (!hasKnownModulesOnly(raw)) return null;
  return { ...raw };
}

/// One descriptor per library. `type` is this app's internal name; `kind` is what goes in the file.
export const PACK_KINDS = {
  loudness: {
    type: "loudness",
    kind: "loudness-pack",
    extension: "plvsloudness",
    label: "Loudness Profiles",
    filterName: "PLVS Loudness Profiles",
    defaultBaseName: "plvs-loudness",
    normalizeItem: normalizeRuleDocument,
    version: LOUDNESS_PACK_VERSION,
  },
  presets: {
    type: "presets",
    kind: "preset-pack",
    extension: "plvspreset",
    label: "Presets",
    filterName: "PLVS Presets",
    defaultBaseName: "plvs-presets",
    normalizeItem: normalizePresetEntry,
  },
  themes: {
    type: "themes",
    kind: "theme-pack",
    extension: "plvstheme",
    label: "Theme",
    filterName: "PLVS Themes",
    defaultBaseName: "plvs-themes",
    normalizeItem: normalizeThemeDocument,
    version: THEME_PACK_VERSION,
  },
};

export function packDescriptor(type) {
  const descriptor = PACK_KINDS[type];
  if (!descriptor) throw new Error(`Unknown pack type: ${type}`);
  return descriptor;
}

/// The profile ids a set of presets refers to. `off` and malformed selections yield nothing.
export function referencedProfileIds(presets) {
  const ids = new Set();
  for (const preset of presets) {
    const { kind, id } = parseSelection(preset?.loudnessProfileActive);
    if (kind === "profile" && id) ids.add(id);
  }
  return ids;
}

export function buildPack(
  type,
  items,
  { exportedAt = new Date().toISOString(), loudnessProfiles = [] } = {}
) {
  const descriptor = packDescriptor(type);
  if (type === "loudness") {
    const sourceItems = Array.isArray(items) ? items : [];
    if (sourceItems.length === 0) {
      throw new PackValidationError("There are no Loudness Profiles to export.", [
        issue("emptyItems", "$.items", "A Loudness Profile pack needs at least one item."),
      ]);
    }
    const portableItems = sourceItems.map((item, index) => {
      const id = normalizePortableItemId(item?.id);
      if (!id) {
        throw new PackValidationError("A Loudness Profile selected for export has an invalid ID.", [
          issue("invalidProfileId", `$.items[${index}].id`, "The Loudness Profile ID is invalid."),
        ]);
      }
      try {
        return { id, ...loudnessProfileToPortable(item) };
      } catch (error) {
        if (!(error instanceof PortableLoudnessProfileError)) throw error;
        throw new PackValidationError("A Loudness Profile selected for export is invalid.", [
          ...prefixIssues(error.issues, `$.items[${index}]`),
        ]);
      }
    });
    return {
      app: PACK_APP,
      kind: descriptor.kind,
      version: descriptor.version,
      items: portableItems,
      dependencies: [],
    };
  }
  if (type === "themes") {
    const sourceItems = Array.isArray(items) ? items : [];
    // Pack V2 requires at least one primary Item, so an empty library has nothing to export.
    if (sourceItems.length === 0) {
      throw new PackValidationError("There are no custom Themes to export.", [
        issue("emptyItems", "$.items", "A Theme pack needs at least one Theme."),
      ]);
    }
    const portableItems = sourceItems.map((item, index) => {
      const id = normalizeThemeId(item?.id);
      if (!id) {
        throw new PackValidationError("A Theme selected for export has an invalid ID.", [
          issue("invalidThemeId", `$.items[${index}].id`, "The Theme ID is invalid."),
        ]);
      }
      try {
        return { id, ...themeToPortable(item) };
      } catch (error) {
        if (!(error instanceof PortableThemeError)) throw error;
        throw new PackValidationError("A Theme selected for export is invalid.", [
          ...prefixIssues(error.issues, `$.items[${index}]`),
        ]);
      }
    });
    return {
      app: PACK_APP,
      kind: descriptor.kind,
      version: descriptor.version,
      items: portableItems,
      dependencies: [],
    };
  }
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => descriptor.normalizeItem(item))
    .filter(Boolean);

  const pack = {
    app: PACK_APP,
    kind: descriptor.kind,
    version: PACK_VERSION,
    exportedAt,
    items: normalizedItems,
  };

  if (type === "presets") {
    const wanted = referencedProfileIds(normalizedItems);
    pack.loudnessProfiles = (Array.isArray(loudnessProfiles) ? loudnessProfiles : [])
      .map((profile) => normalizeRuleDocument(profile))
      .filter((profile) => profile && wanted.has(profile.id));
  }

  return pack;
}

/// Kind of the whole-configuration file, so a user who picks one gets told what it is instead of
/// "not a PLVS file". Mirrors `PROFILE_KIND` in `src/persistence/profileShape.js`.
const CONFIGURATION_PROFILE_KIND = "configuration-profile";

export class PackValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "PackValidationError";
    this.issues = issues;
  }
}

function issue(code, path, message) {
  return { code, path, message };
}

function prefixIssues(issues, prefix) {
  return issues.map((entry) => ({
    ...entry,
    path: entry.path === "$" ? prefix : `${prefix}${entry.path.slice(1)}`,
  }));
}

function parseLegacyThemeItems(raw) {
  if (!Array.isArray(raw.items)) {
    throw new PackValidationError("This Theme file is missing its items.", [
      issue("invalidItems", "$.items", "items must be an array."),
    ]);
  }
  const issues = [];
  const items = raw.items.map((item, index) => {
    const normalized = normalizeThemeDocument(item);
    if (!normalized) {
      issues.push(
        issue("invalidLegacyTheme", `$.items[${index}]`, "This legacy Theme entry cannot be read.")
      );
    }
    return normalized;
  });
  if (issues.length > 0) {
    throw new PackValidationError("This Theme file contains an invalid Theme.", issues);
  }
  return items;
}

const PACK_V2_FIELDS = new Set(["app", "kind", "version", "createdWith", "items", "dependencies"]);
const PORTABLE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_ITEM_IDS = new Set(["__proto__", "prototype", "constructor"]);

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePortableItemId(value) {
  if (typeof value !== "string" || !PORTABLE_ITEM_ID.test(value)) return null;
  return RESERVED_ITEM_IDS.has(value) ? null : value;
}

function collectPackV2EnvelopeIssues(raw, issues, { dependencyKind = null } = {}) {
  for (const field of Object.keys(raw)) {
    if (!PACK_V2_FIELDS.has(field)) {
      issues.push(issue("unknownField", `$.${field}`, `Unknown field: ${field}.`));
    }
  }
  if ("createdWith" in raw) {
    if (!isObjectRecord(raw.createdWith)) {
      issues.push(issue("invalidCreatedWith", "$.createdWith", "createdWith must be an object."));
    } else {
      for (const field of Object.keys(raw.createdWith)) {
        if (field !== "appVersion") {
          issues.push(issue("unknownField", `$.createdWith.${field}`, `Unknown field: ${field}.`));
        }
      }
      if ("appVersion" in raw.createdWith && typeof raw.createdWith.appVersion !== "string") {
        issues.push(
          issue("invalidAppVersion", "$.createdWith.appVersion", "appVersion must be a string.")
        );
      }
    }
  }
  if (!Array.isArray(raw.dependencies)) {
    issues.push(issue("invalidDependencies", "$.dependencies", "dependencies must be an array."));
  } else if (dependencyKind === null && raw.dependencies.length > 0) {
    issues.push(
      issue("unsupportedDependency", "$.dependencies", "This pack kind has no dependencies.")
    );
  }
}

function parsePortableLoudnessItems(raw) {
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new PackValidationError("This Loudness Profile file is missing its items.", [
      issue("invalidItems", "$.items", "items must be a non-empty array."),
    ]);
  }
  const issues = [];
  collectPackV2EnvelopeIssues(raw, issues);
  const seenIds = new Set();
  const items = [];
  raw.items.forEach((item, index) => {
    const path = `$.items[${index}]`;
    if (!isObjectRecord(item)) {
      issues.push(
        issue("invalidProfileEntry", path, "A Loudness Profile entry must be an object.")
      );
      return;
    }
    const { id: rawId, ...document } = item;
    const id = normalizePortableItemId(rawId);
    if (!id) {
      issues.push(issue("invalidProfileId", `${path}.id`, "id is invalid."));
      return;
    }
    if (seenIds.has(id)) {
      issues.push(issue("duplicateProfileId", `${path}.id`, `Duplicate id: ${id}.`));
    } else {
      seenIds.add(id);
    }
    try {
      items.push(portableToStoredLoudnessProfile(document, id));
    } catch (error) {
      if (!(error instanceof PortableLoudnessProfileError)) throw error;
      issues.push(...prefixIssues(error.issues, path));
    }
  });
  if (issues.length > 0) {
    throw new PackValidationError(
      "This Loudness Profile file contains an invalid Loudness Profile.",
      issues
    );
  }
  return items;
}

function parsePortableThemeItems(raw) {
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new PackValidationError("This Theme file is missing its items.", [
      issue("invalidItems", "$.items", "items must be a non-empty array."),
    ]);
  }
  const issues = [];
  collectPackV2EnvelopeIssues(raw, issues);
  const seenIds = new Set();
  const items = [];
  raw.items.forEach((item, index) => {
    const path = `$.items[${index}]`;
    if (!isObjectRecord(item)) {
      issues.push(issue("invalidThemeEntry", path, "A Theme pack entry must be an object."));
      return;
    }
    const { id: rawId, ...document } = item;
    const id = normalizeThemeId(rawId);
    if (!id) {
      issues.push(issue("invalidThemeId", `${path}.id`, "id is invalid."));
      return;
    }
    if (seenIds.has(id)) {
      issues.push(issue("duplicateThemeId", `${path}.id`, `Duplicate id: ${id}.`));
    } else {
      seenIds.add(id);
    }
    try {
      items.push(portableToStoredTheme(document, id));
    } catch (error) {
      if (!(error instanceof PortableThemeError)) throw error;
      issues.push(...prefixIssues(error.issues, path));
    }
  });
  if (issues.length > 0) {
    throw new PackValidationError("This Theme file contains an invalid Theme.", issues);
  }
  return items;
}

function descriptorForKind(kind) {
  return Object.values(PACK_KINDS).find((entry) => entry.kind === kind) ?? null;
}

export function parsePack(raw, expectedType) {
  const expected = packDescriptor(expectedType);

  if (expectedType === "themes" && raw?.kind === PORTABLE_THEME_KIND) {
    return parsePortableThemeTransfer(raw, {
      invalidMessage: "This Theme file contains an invalid Theme.",
      newerMessage: "This Theme file was made by a newer version of PLVS.",
    });
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.app !== PACK_APP) {
    throw new PackValidationError("This is not a PLVS file.");
  }
  if (raw.kind !== expected.kind) {
    if (raw.kind === CONFIGURATION_PROFILE_KIND) {
      throw new PackValidationError(
        "This is a whole configuration file. Import it from the Configuration row."
      );
    }
    const other = descriptorForKind(raw.kind);
    if (other) {
      throw new PackValidationError(
        `This is a ${other.label} file. Import it from the ${other.label} row.`
      );
    }
    throw new PackValidationError("This is not a PLVS file.");
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new PackValidationError("This file is missing a version.");
  }
  const latestVersion = expected.version ?? PACK_VERSION;
  if (raw.version > latestVersion) {
    throw new PackValidationError("This file was made by a newer version of PLVS.");
  }

  const items =
    expectedType === "loudness" && raw.version === LOUDNESS_PACK_VERSION
      ? parsePortableLoudnessItems(raw)
      : expectedType === "themes"
        ? raw.version === 1
          ? parseLegacyThemeItems(raw)
          : parsePortableThemeItems(raw)
        : (Array.isArray(raw.items) ? raw.items : [])
            .map((item) => expected.normalizeItem(item))
            .filter(Boolean);

  const parsed = {
    app: PACK_APP,
    kind: expected.kind,
    version: raw.version,
    // Unlike `buildPack`, an invalid/missing value here defaults to "" rather than "now" -- a read
    // path must not fabricate provenance for a file it did not write.
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    items,
  };

  if (expectedType === "presets") {
    parsed.loudnessProfiles = (Array.isArray(raw.loudnessProfiles) ? raw.loudnessProfiles : [])
      .map((profile) => normalizeRuleDocument(profile))
      .filter(Boolean);
  }

  return parsed;
}

function parsePortableThemeTransfer(raw, { invalidMessage, newerMessage }) {
  if (
    raw?.formatVersion > PORTABLE_THEME_FORMAT_VERSION ||
    raw?.semanticsVersion > PORTABLE_THEME_SEMANTICS_VERSION
  ) {
    throw new PackValidationError(newerMessage);
  }
  let theme;
  try {
    // A standalone portable document has no ID; this placeholder only satisfies the stored shape.
    // `identity: "content"` tells the import planner to match by content and mint a local ID.
    theme = portableToStoredTheme(raw, "custom-shared-theme");
  } catch (error) {
    if (!(error instanceof PortableThemeError)) throw error;
    throw new PackValidationError(invalidMessage, error.issues);
  }
  return {
    app: PACK_APP,
    kind: PACK_KINDS.themes.kind,
    version: THEME_PACK_VERSION,
    exportedAt: "",
    identity: "content",
    items: [theme],
  };
}

/** Parse the canonical portable Theme copied by a community page, without inventing a new format. */
export function parseClipboardTheme(raw) {
  return parsePortableThemeTransfer(raw, {
    invalidMessage: "Clipboard doesn't contain a PLVS Theme.",
    newerMessage: "This Theme requires a newer version of PLVS.",
  });
}
