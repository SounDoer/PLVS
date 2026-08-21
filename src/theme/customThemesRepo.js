import { themesStore } from "../persistence/index.js";
import { normalizeThemeDocument } from "./migrations/migrateV1Theme.js";

function readState() {
  const raw = themesStore.read();
  const themes = raw && typeof raw.themes === "object" && raw.themes ? raw.themes : {};
  const order = Array.isArray(raw && raw.order) ? raw.order : [];
  return { themes, order };
}

/** @returns {Record<string, object>} normalized Theme V2 documents keyed by id */
export function listCustomThemes() {
  const { themes } = readState();
  /** @type {Record<string, object>} */
  const out = {};
  for (const [id, t] of Object.entries(themes)) {
    const normalized = normalizeThemeDocument(t);
    // A document whose own id disagrees with the key it is stored under cannot
    // be addressed either way round, so it is not a theme this app can use.
    if (normalized && normalized.id === id) out[id] = normalized;
  }
  return out;
}

/** @returns {Record<string, object>} normalized Theme V2 documents keyed by id */
export function listCustomThemeDocuments() {
  return listCustomThemes();
}

/** @returns {object[]} normalized Theme V2 documents in display order */
export function listCustomThemeDocumentsOrdered() {
  return listCustomThemesOrdered();
}

/** @returns {object[]} valid custom themes in display order */
export function listCustomThemesOrdered() {
  const { order } = readState();
  const valid = listCustomThemes();
  const seen = new Set();
  const ordered = [];
  for (const id of order) {
    if (valid[id] && !seen.has(id)) {
      ordered.push(valid[id]);
      seen.add(id);
    }
  }
  for (const [id, t] of Object.entries(valid)) {
    if (!seen.has(id)) ordered.push(t);
  }
  return ordered;
}

export function upsertCustomTheme(theme) {
  const n = normalizeThemeDocument(theme);
  if (!n) return;
  const { themes, order } = readState();
  themesStore.patch({
    themes: { ...themes, [n.id]: n },
    order: order.includes(n.id) ? order : [...order, n.id],
  });
}

export function removeCustomTheme(id) {
  const { themes, order } = readState();
  const { [id]: _drop, ...rest } = themes;
  themesStore.patch({ themes: rest, order: order.filter((x) => x !== id) });
}
