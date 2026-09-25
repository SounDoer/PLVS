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
import { PortablePresetError, portableToStoredPreset, presetToPortable } from "./portablePreset.js";
import {
  collectPackResourceIssues,
  collectPackV2EnvelopeIssues,
  MAX_PACK_BYTES,
  normalizePortableItemId,
  packIssue,
  parsePackV2Items,
  prefixPackIssues,
} from "./packV2.js";
// `panelInstances.js` imports `moduleCatalog.js` only. Never reach `workspace/registry.jsx` from
// here -- it evaluates every canvas panel and costs about two seconds per import.
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

export const PACK_APP = "PLVS";
export const PACK_VERSION = 1;
export const LOUDNESS_PACK_VERSION = 2;
export const PRESET_PACK_VERSION = 2;
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
    version: PRESET_PACK_VERSION,
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
  if (type === "presets") {
    const sourceItems = Array.isArray(items) ? items : [];
    if (sourceItems.length === 0) {
      throw new PackValidationError("There are no Presets to export.", [
        issue("emptyItems", "$.items", "A Preset pack needs at least one item."),
      ]);
    }
    const profiles = Array.isArray(loudnessProfiles) ? loudnessProfiles : [];
    const portableItems = sourceItems.map((item, index) => {
      const id = normalizePortableItemId(item?.id);
      if (!id) {
        throw new PackValidationError("A Preset selected for export has an invalid ID.", [
          issue("invalidPresetId", `$.items[${index}].id`, "The Preset ID is invalid."),
        ]);
      }
      try {
        return { id, ...presetToPortable(item, { loudnessProfiles: profiles }) };
      } catch (error) {
        if (!(error instanceof PortablePresetError)) throw error;
        throw new PackValidationError("A Preset selected for export is invalid.", [
          ...prefixIssues(error.issues, `$.items[${index}]`),
        ]);
      }
    });
    const wanted = referencedProfileIds(sourceItems);
    const dependencyItems = profiles
      .filter((profile) => wanted.has(profile.id))
      .map((profile, index) => {
        const id = normalizePortableItemId(profile?.id);
        if (!id) {
          throw new PackValidationError("A bundled Loudness Profile has an invalid ID.", [
            issue(
              "invalidProfileId",
              `$.dependencies[0].items[${index}].id`,
              "The Loudness Profile ID is invalid."
            ),
          ]);
        }
        try {
          return { id, ...loudnessProfileToPortable(profile) };
        } catch (error) {
          if (!(error instanceof PortableLoudnessProfileError)) throw error;
          throw new PackValidationError("A bundled Loudness Profile is invalid.", [
            ...prefixIssues(error.issues, `$.dependencies[0].items[${index}]`),
          ]);
        }
      });
    return {
      app: PACK_APP,
      kind: descriptor.kind,
      version: descriptor.version,
      items: portableItems,
      dependencies:
        dependencyItems.length > 0 ? [{ kind: "loudness-profile", items: dependencyItems }] : [],
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
  return packIssue(code, path, message);
}

function prefixIssues(issues, prefix) {
  return prefixPackIssues(issues, prefix);
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

function parsePortableLoudnessItems(raw) {
  const issues = collectPackV2EnvelopeIssues(raw);
  const parsed = parsePackV2Items(raw, {
    entryLabel: "Loudness Profile",
    invalidEntryCode: "invalidProfileEntry",
    invalidIdCode: "invalidProfileId",
    duplicateIdCode: "duplicateProfileId",
    convert: portableToStoredLoudnessProfile,
  });
  issues.push(...parsed.issues);
  if (issues.length > 0) {
    throw new PackValidationError(
      "This Loudness Profile file contains an invalid Loudness Profile.",
      issues
    );
  }
  return parsed.items;
}

function parsePortableThemeItems(raw) {
  const issues = collectPackV2EnvelopeIssues(raw);
  const parsed = parsePackV2Items(raw, {
    entryLabel: "Theme",
    invalidEntryCode: "invalidThemeEntry",
    invalidIdCode: "invalidThemeId",
    duplicateIdCode: "duplicateThemeId",
    convert(document, id) {
      const themeId = normalizeThemeId(id);
      if (!themeId) {
        throw new PortableThemeError([issue("invalidThemeId", "$.id", "The Theme ID is invalid.")]);
      }
      return portableToStoredTheme(document, themeId);
    },
  });
  issues.push(...parsed.issues);
  if (issues.length > 0) {
    throw new PackValidationError("This Theme file contains an invalid Theme.", issues);
  }
  return parsed.items;
}

function parsePortablePresetItems(raw) {
  const issues = collectPackV2EnvelopeIssues(raw, {
    allowedDependencyKind: "loudness-profile",
  });
  const dependencyGroupIndex = Array.isArray(raw.dependencies)
    ? raw.dependencies.findIndex((group) => group?.kind === "loudness-profile")
    : -1;
  const dependencyGroup = dependencyGroupIndex >= 0 ? raw.dependencies[dependencyGroupIndex] : null;
  const dependencyItemsPath =
    dependencyGroupIndex >= 0
      ? `$.dependencies[${dependencyGroupIndex}].items`
      : "$.dependencies[0].items";
  const profiles = parsePackV2Items(raw, {
    entryLabel: "Loudness Profile dependency",
    invalidEntryCode: "invalidProfileEntry",
    invalidIdCode: "invalidProfileId",
    duplicateIdCode: "duplicateProfileId",
    convert: portableToStoredLoudnessProfile,
    items: dependencyGroup?.items ?? [],
    itemsPath: dependencyItemsPath,
  });
  issues.push(...profiles.issues);
  const dependencyIds = new Set(profiles.items.map(({ id }) => id));
  const presets = parsePackV2Items(raw, {
    entryLabel: "Preset",
    invalidEntryCode: "invalidPresetEntry",
    invalidIdCode: "invalidPresetId",
    duplicateIdCode: "duplicatePresetId",
    convert(document, id) {
      return portableToStoredPreset(document, id, {
        resolveDependencyId: (dependencyId) =>
          dependencyIds.has(dependencyId) ? dependencyId : null,
      });
    },
  });
  issues.push(...presets.issues);
  const referencedDependencyIds = new Set(
    Array.isArray(raw.items)
      ? raw.items
          .map((item) => item?.loudnessProfile?.dependencyId)
          .filter((id) => typeof id === "string")
      : []
  );
  profiles.items.forEach((profile, index) => {
    if (!referencedDependencyIds.has(profile.id)) {
      issues.push(
        issue(
          "unusedDependency",
          `${dependencyItemsPath}[${index}].id`,
          `Loudness Profile dependency ${profile.id} is not referenced by a Preset.`
        )
      );
    }
  });
  if (issues.length > 0) {
    throw new PackValidationError("This Preset file contains invalid portable content.", issues);
  }
  return { items: presets.items, loudnessProfiles: profiles.items };
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
  if (raw.version === 1) {
    const resourceIssues = collectPackResourceIssues(raw);
    if (resourceIssues.length > 0) {
      throw new PackValidationError("This file exceeds PLVS sharing limits.", resourceIssues);
    }
  }

  const portablePresets =
    expectedType === "presets" && raw.version === PRESET_PACK_VERSION
      ? parsePortablePresetItems(raw)
      : null;
  const items = portablePresets
    ? portablePresets.items
    : expectedType === "loudness" && raw.version === LOUDNESS_PACK_VERSION
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
    parsed.loudnessProfiles = portablePresets
      ? portablePresets.loudnessProfiles
      : (Array.isArray(raw.loudnessProfiles) ? raw.loudnessProfiles : [])
          .map((profile) => normalizeRuleDocument(profile))
          .filter(Boolean);
  }

  return parsed;
}

function parseJsonText(text) {
  if (typeof text !== "string") {
    throw new PackValidationError("This file could not be read.", [
      issue("invalidJson", "$", "The Pack must be encoded as JSON text."),
    ]);
  }
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_PACK_BYTES) {
    throw new PackValidationError("This file is too large to import.", [
      {
        ...issue("packTooLarge", "$", `The Pack exceeds the ${MAX_PACK_BYTES}-byte limit.`),
        details: { byteLength, limit: MAX_PACK_BYTES },
      },
    ]);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    throw new PackValidationError("This file could not be read.", [
      issue("invalidJson", "$", "The file does not contain valid JSON."),
    ]);
  }
  return raw;
}

/** Enforces the encoded byte limit before JSON parsing, then applies the normal family parser. */
export function parsePackText(text, expectedType) {
  return parsePack(parseJsonText(text), expectedType);
}

/** Dispatches one shared Item file by its document kind, then runs the same strict family parser. */
export function parseSharedPackText(text) {
  const raw = parseJsonText(text);
  if (raw?.kind === PORTABLE_THEME_KIND) {
    return { type: "themes", pack: parsePack(raw, "themes") };
  }
  if (raw?.kind === CONFIGURATION_PROFILE_KIND) {
    throw new PackValidationError(
      "This is a whole configuration file. Import it from the Configuration row."
    );
  }
  const descriptor = descriptorForKind(raw?.kind);
  if (!descriptor || raw?.app !== PACK_APP) {
    throw new PackValidationError("This is not a PLVS shared item file.");
  }
  return { type: descriptor.type, pack: parsePack(raw, descriptor.type) };
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
