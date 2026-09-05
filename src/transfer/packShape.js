/// The pack file format: three kinds, one envelope. The only module that knows what a pack file
/// looks like on disk. Modelled on `src/persistence/profileShape.js`, which does the same job for
/// the whole-configuration `.plvsconfig` file.
///
/// A pack is a *sharing* artefact, not a backup: import merges it into the recipient's library and
/// never overwrites anything, so nothing here needs to describe removal or selection state.

import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import { normalizeThemeDocument } from "../theme/migrations/migrateV1Theme.js";
// `panelInstances.js` imports `moduleCatalog.js` only. Never reach `workspace/registry.jsx` from
// here -- it evaluates every canvas panel and costs about two seconds per import.
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

export const PACK_APP = "PLVS";
export const PACK_VERSION = 1;

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
  constructor(message) {
    super(message);
    this.name = "PackValidationError";
  }
}

function descriptorForKind(kind) {
  return Object.values(PACK_KINDS).find((entry) => entry.kind === kind) ?? null;
}

export function parsePack(raw, expectedType) {
  const expected = packDescriptor(expectedType);

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
  if (raw.version > PACK_VERSION) {
    throw new PackValidationError("This file was made by a newer version of PLVS.");
  }

  const items = (Array.isArray(raw.items) ? raw.items : [])
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
