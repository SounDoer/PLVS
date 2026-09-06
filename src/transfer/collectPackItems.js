/// Resolves an export selection to the items and the extra pack options `buildPack` needs.
///
/// Lives here rather than in `usePackTransfer.js` because App Control's export handler needs the
/// same rule, and a pack's contents are pack-format logic, not GUI wiring.

import { getAdapter } from "./libraryAdapters.js";
import { referencedProfileIds } from "./packShape.js";

/**
 * @param {"loudness" | "presets" | "themes"} type
 * @param {string[] | null} ids selected ids, or null for the whole library
 * @returns {{ items: object[], options: object, missingIds: string[] }}
 *   `missingIds` is non-empty when a requested id is not in the library. The caller decides whether
 *   that is an error; this function never silently drops one.
 */
export function collectPackItems(type, ids) {
  const library = getAdapter(type).list();

  let items = library;
  let missingIds = [];
  if (ids !== null) {
    const byId = new Map(library.map((item) => [item.id, item]));
    missingIds = ids.filter((id) => !byId.has(id));
    // Library order, not selection order: a pack is a snapshot of part of a library, and two
    // exports of the same set must produce the same file.
    const selectedIds = new Set(ids);
    items = library.filter((item) => selectedIds.has(item.id));
  }

  const options = {};
  if (type === "presets") {
    const referenced = referencedProfileIds(items);
    options.loudnessProfiles = getAdapter("loudness")
      .list()
      .filter((profile) => referenced.has(profile.id));
  }

  return { items, options, missingIds };
}
