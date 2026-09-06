/// App Control's view of the three shareable libraries.
///
/// It owns only what App Control adds: the family names on the wire, which error code a missing id
/// gets, and the result shapes. Everything about pack files -- the envelope, the merge rules, the
/// renaming, the preset-to-profile bundling, the three libraries' container shapes -- stays in
/// `src/transfer/`, which the GUI calls too. Nothing here restates any of it.

import { collectPackItems } from "../transfer/collectPackItems.js";
import { getAdapter } from "../transfer/libraryAdapters.js";
import { buildPack, packDescriptor, parsePack } from "../transfer/packShape.js";
import { planPackImport } from "../transfer/mergeIntoLibrary.js";

/// Keyed by App Control family name; `packType` is `src/transfer/`'s internal name for the same
/// library. The two vocabularies differ (`preset` vs `presets`, `loudnessProfile` vs `loudness`)
/// and this is the only place that knows it.
export const LIBRARY_FAMILIES = {
  preset: { packType: "presets", stateKey: "presets", notFoundCode: "presetNotFound" },
  theme: { packType: "themes", stateKey: "themes", notFoundCode: "themeNotFound" },
  loudnessProfile: {
    packType: "loudness",
    stateKey: "profiles",
    notFoundCode: "loudnessProfileNotFound",
  },
};

export function libraryFamily(family) {
  const descriptor = LIBRARY_FAMILIES[family];
  if (!descriptor) throw new Error(`Unknown library family: ${family}`);
  return descriptor;
}

/// `{ id, name }` summaries, the same shape `preset.list` already returns.
export function buildLibraryList(family) {
  return getAdapter(libraryFamily(family).packType)
    .list()
    .map(({ id, name }) => ({ id, name }));
}

/**
 * @param {string} family
 * @param {string[] | null} ids null exports the whole library
 * @returns {{ pack: object | null, missingIds: string[] }} `pack` is null when any id is missing:
 *   the caller must fail rather than export the subset that matched.
 */
export function planLibraryExport(family, ids) {
  const { packType } = libraryFamily(family);
  const { items, options, missingIds } = collectPackItems(packType, ids);
  if (missingIds.length > 0) return { pack: null, missingIds };
  return { pack: buildPack(packType, items, options), missingIds: [] };
}

/**
 * Validates and plans an import without writing. Throws `PackValidationError` for a document that
 * is not a valid pack for this family; its message is written for a person who received a shared
 * file and is passed through verbatim.
 *
 * @returns {{ changed: boolean, plan: { items: object[], loudnessProfiles: object[] },
 *   commit: () => void }} `commit` performs the append; a dry run simply never calls it.
 */
export function planLibraryImport(family, raw) {
  const { packType } = libraryFamily(family);
  const pack = parsePack(raw, packType);
  const planned = planPackImport(packType, pack, {
    existingItems: getAdapter(packType).list(),
    existingProfiles: packType === "presets" ? getAdapter("loudness").list() : [],
  });

  const changed = planned.itemAdditions.length > 0 || planned.profileAdditions.length > 0;

  return {
    changed,
    plan: {
      items: planned.itemPlan,
      loudnessProfiles: planned.profilePlan,
    },
    /// Writes through the adapters and nothing else. They are what announce the write to the
    /// React state that owns each library (`notifyLocal`); reaching a store directly here would
    /// land the data and leave the list on screen unchanged.
    commit() {
      if (planned.profileAdditions.length > 0) {
        getAdapter("loudness").append(planned.profileAdditions);
      }
      getAdapter(packType).append(planned.itemAdditions);
    },
  };
}

/// Exposed so the contract guard can compare against `PACK_KINDS` without importing the bridge.
export function libraryPackKind(family) {
  return packDescriptor(libraryFamily(family).packType).kind;
}
