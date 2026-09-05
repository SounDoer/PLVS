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
