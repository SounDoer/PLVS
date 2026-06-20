import { themesStore } from "../persistence/index.js";
import { normalizeCustomTheme } from "./customTheme.js";

function readState() {
  const raw = themesStore.read();
  const themes = raw && typeof raw.themes === "object" && raw.themes ? raw.themes : {};
  const order = Array.isArray(raw && raw.order) ? raw.order : [];
  return { themes, order };
}

/** @returns {Record<string, object>} valid custom themes keyed by id */
export function listCustomThemes() {
  const { themes } = readState();
  /** @type {Record<string, object>} */
  const out = {};
  for (const [id, t] of Object.entries(themes)) {
    const n = normalizeCustomTheme(t);
    if (n) out[id] = n;
  }
  return out;
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
  const n = normalizeCustomTheme(theme);
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
