/**
 * Arrays use bracket indexing so a negative index never wraps to the end.
 * @param {number} index
 */
export function rowAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.rowAt === "function") return entries.rowAt(index);
  if (typeof entries.at === "function" && !Array.isArray(entries)) return entries.at(index);
  return entries[index];
}
