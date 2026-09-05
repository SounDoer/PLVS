/// The conflict rules for importing a pack, as a pure function: no store, no React, no IO.
///
/// Import is *merge-only* -- nothing local is ever overwritten or deleted -- so the result is
/// simply a list of items to append plus a plan describing what happened to each incoming item.
/// That is also why the review dialog can show the outcome before anything is written: this
/// function produces the whole answer without touching the library.

const defaultMakeId = () => crypto.randomUUID();

/// Value equality over the plain-JSON documents these libraries store. `JSON.stringify` would be
/// shorter and wrong: a preset normalizer spreads the incoming object, so key order follows the
/// file rather than the local entry, and two identical presets would compare as different.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

/// ` (2)`, incrementing until free. Applies to the incoming item only; a local name never changes.
function freeName(name, taken) {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

/**
 * @param {Array<{id: string, name: string}>} existing normalized items already in the library
 * @param {Array<{id: string, name: string}>} incoming normalized items from the pack
 * @returns {{ additions: object[], plan: Array<{sourceId: string, finalId: string, name: string,
 *   disposition: "added" | "skipped" | "duplicated"}> }}
 */
export function planMerge(existing, incoming, { makeId = defaultMakeId } = {}) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const takenNames = new Set(existing.map((item) => item.name));
  const additions = [];
  const plan = [];

  for (const item of incoming) {
    const local = byId.get(item.id);

    if (local && deepEqual(local, item)) {
      plan.push({ sourceId: item.id, finalId: item.id, name: item.name, disposition: "skipped" });
      continue;
    }

    const disposition = local ? "duplicated" : "added";
    const finalId = local ? makeId() : item.id;
    const name = freeName(item.name, takenNames);
    const added = { ...item, id: finalId, name };

    takenNames.add(name);
    byId.set(finalId, added);
    additions.push(added);
    plan.push({ sourceId: item.id, finalId, name, disposition });
  }

  return { additions, plan };
}
