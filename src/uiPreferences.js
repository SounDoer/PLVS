/**
 * Public entry for UI preferences: tunable layout/typography + chart defaults.
 *
 * - **Data** — `src/preferences/data.js` (`UI_PREFERENCES`, `getResolvedCharts`)
 * - **Persistence** — `src/preferences/layoutPersistence.js` (theme + layout keys in localStorage)
 * - **Apply** — `src/preferences/applyDocumentTheme.js` (`applyUiPreferencesToDocument`)
 *
 * `applyUiPreferencesToDocument` writes `--ui-*` layout/chart variables, applies shadcn semantic
 * tokens (`src/theme/shadcnSemanticPreset.js`), maps resolved chart strokes to `--chart-*` for Tailwind,
 * and derives legacy `--ui-color-*` via `meterColorBridge`.
 *
 * Debug: DevTools → `<html>` → Computed → filter `--ui-` or `--background`.
 */

export { UI_PREFERENCES, getResolvedCharts } from "./preferences/data.js";
export {
  readPersistedVectorscopePair,
  readPersistedUiMode,
  readSystemPrefersDark,
  resolveEffectiveUiMode,
} from "./preferences/layoutPersistence.js";
export { applyUiPreferencesToDocument } from "./preferences/applyDocumentTheme.js";
