/**
 * Public entry for UI preferences: tunable layout/typography/iconography + chart geometry.
 *
 * - **Data** — `src/preferences/data.js` (`UI_PREFERENCES`)
 * - **Persistence** — `src/persistence/` (domain stores: `settingsStore`, `workspaceStore`) + `src/preferences/themeResolve.js`
 * - **Apply** — `src/preferences/applyDocumentTheme.js` (`applyLayoutToDocument`, `applyThemeToDocument`)
 *
 * `applyLayoutToDocument` writes spatial/typographic/iconographic `--ui-*` variables; `applyThemeToDocument` sets
 * `data-theme`, `color-scheme`, shadcn semantic tokens, and derived instrument colour tokens.
 *
 * Debug: DevTools → `<html>` → Computed → filter `--ui-` or `--background`.
 */

export { UI_PREFERENCES } from "./preferences/data.js";
export { readSystemPrefersDark } from "./preferences/layoutPersistence.js";
export {
  DEFAULT_THEME_ID,
  isThemeId,
  parsePersistedUiStateJson,
  readPersistedShellThemeFields,
  resolveThemeId,
  THEME_IDS,
} from "./preferences/themeResolve.js";
export { applyLayoutToDocument, applyThemeToDocument } from "./preferences/applyDocumentTheme.js";
export {
  DEFAULT_INTERFACE_SIZE,
  INTERFACE_SIZE_OPTIONS,
  normalizeInterfaceSize,
  readPersistedInterfaceSize,
  resolveInterfacePreferences,
  resolveInterfacePreferencesForSurface,
} from "./preferences/interfaceSize.js";
