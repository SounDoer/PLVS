export const CUSTOM_THEME_ID_PREFIX = "custom-";

/** @param {unknown} id */
export function isCustomThemeId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_THEME_ID_PREFIX);
}

const defaultMakeId = () => `${CUSTOM_THEME_ID_PREFIX}${crypto.randomUUID()}`;

/**
 * Snapshot a builtin or custom theme into a new editable CustomTheme.
 * @param {{colorScheme:string, seeds:object, semantic:object, colormap:unknown}} base
 * @param {string} name
 * @param {() => string} [makeId]
 */
export function makeCustomThemeFromBase(base, name, makeId = defaultMakeId) {
  return {
    id: makeId(),
    name: String(name),
    colorScheme: base.colorScheme === "light" ? "light" : "dark",
    seeds: {
      accent: base.seeds.accent,
      accentSecondary: base.seeds.accentSecondary,
      signal: {
        good: base.seeds.signal.good,
        warn: base.seeds.signal.warn,
        bad: base.seeds.signal.bad,
      },
    },
    semantic: { ...base.semantic },
    colormap: structuredClone(base.colormap),
  };
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate a persisted custom theme; return it (as-is) or null if malformed.
 * @param {unknown} raw
 */
export function normalizeCustomTheme(raw) {
  if (!raw || typeof raw !== "object") return null;
  const t = /** @type {any} */ (raw);
  if (!isCustomThemeId(t.id) || !isNonEmptyString(t.name)) return null;
  if (t.colorScheme !== "dark" && t.colorScheme !== "light") return null;
  const s = t.seeds;
  if (!s || typeof s !== "object") return null;
  if (!isNonEmptyString(s.accent) || !isNonEmptyString(s.accentSecondary)) return null;
  if (
    !s.signal ||
    !isNonEmptyString(s.signal.good) ||
    !isNonEmptyString(s.signal.warn) ||
    !isNonEmptyString(s.signal.bad)
  )
    return null;
  if (!t.semantic || typeof t.semantic !== "object") return null;
  if (!Array.isArray(t.colormap)) return null;
  return t;
}
