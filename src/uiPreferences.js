/**
 * Public entry for UI preferences: tunable layout/typography + chart geometry.
 *
 * - **Data** — `src/preferences/data.js` (`UI_PREFERENCES`)
 * - **Persistence** — `src/preferences/layoutPersistence.js` + `src/preferences/themeResolve.js`
 * - **Apply** — `src/preferences/applyDocumentTheme.js` (`applyLayoutToDocument`, `applyThemeToDocument`)
 *
 * `applyLayoutToDocument` writes spatial/typographic `--ui-*` variables; `applyThemeToDocument` sets
 * `data-theme`, `color-scheme`, shadcn semantic tokens, `--ui-color-*`, chart strokes, and the peak gradient.
 *
 * Debug: DevTools → `<html>` → Computed → filter `--ui-` or `--background`.
 */

export { UI_PREFERENCES } from "./preferences/data.js";
export {
  readPersistedVectorscopePair,
  readSystemPrefersDark,
} from "./preferences/layoutPersistence.js";
export {
  DEFAULT_THEME_ID,
  isThemeId,
  parsePersistedUiStateJson,
  readPersistedShellThemeFields,
  resolveThemeId,
  THEME_IDS,
} from "./preferences/themeResolve.js";
export { applyLayoutToDocument, applyThemeToDocument } from "./preferences/applyDocumentTheme.js";
