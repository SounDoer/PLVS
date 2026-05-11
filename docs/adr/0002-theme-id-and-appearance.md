# ADR 0002: Theme id, appearance, and token pipeline

## Status

Accepted

## Implementation status

- **Delivered in tree**: persisted `appearance` / `themeId` (`layoutPersistKey`), `resolveThemeId`, `src/theme/builtinThemes.js` registry, `applyLayoutToDocument` / `applyThemeToDocument` split, Settings separates **follow system** vs **fixed theme**, and **`system` → `fixed` seeds `themeId` from the currently resolved builtin** (Decision 6).
- **GitHub #55 (multi-theme first-paint CSS)**: still **deferred** per **Decision 9**; only a single `theme-fallbacks.css` placeholder (`audiometer-dark`) is generated until first-paint flash with many builtins becomes a product issue.

## Context

AudioMeter will support **multiple named colour themes** (not only built-in light/dark pairs). The UI must stay aligned with **shadcn-style semantic CSS variables** and Tailwind v4, while keeping **layout and typography** easy to tune without duplicating them per theme. Persistence is required during development and for production (layout, splitter ratios, etc.); **custom colour packs** are explicitly **out of scope for now** (may revisit later).

This ADR supersedes the following earlier ideas where they conflict with ADR 0001 §4: **`--chart-1`…`--chart-5` are not overwritten from product chart strokes**; they follow **semantic `chart1`…`chart5` only** (see Decision 7).

## Decision

1. **Single dimension of colour context** — **`themeId` only**. Do **not** use a second axis such as `.dark` on `<html>` or Tailwind `dark:` to mean “theming”. Colours come from the **active resolved theme**. (Removing `@custom-variant dark` / `.dark` is part of the implementation; existing components already rely mostly on semantic tokens.)

2. **Builtin themes are self-contained** — Each registered **`themeId`** ships a **full** token bundle: **`semantic`** (shadcn-shaped surface tokens), **`charts`** (all module stroke/fill inputs that today feed **`--ui-chart-*`**), and **`meterGradient`** (Peak panel fill: **`top` / `mid` / `bottom`** as CSS **`<color>`** plus **`midStopPercent`** — same shape as today’s `UI_PREFERENCES.modules.peak.meterGradient`). **`applyTheme`** writes **`--ui-meter-grad-*`** from the active theme only; **`UI_PREFERENCES`** drops **`modules.peak.meterGradient`** once builtin themes own it (remove during theme-registry rollout). **No runtime merge** with separate module defaults for charts/gradient; copying defaults when authoring a new theme is acceptable.

3. **`buildMeterColorBridge` + optional overrides** — **One shared** function maps shadcn **`semantic`** + a theme’s **`colorScheme`** (`"light"` | `"dark"`, browser hint only — not a second theme axis) to the **bridge object** (keys such as `pageBg`, `divider`, `metricRowBg`, … — same names as today’s `buildMeterColorBridge` return value). Signature: **`buildMeterColorBridge(semantic, colorScheme)`**. **`meterColorOverrides` is not** passed into the bridge; it lives on the **builtin theme record** and is applied **after** the bridge: **`finalColors = { …buildMeterColorBridge(semantic, colorScheme), …(theme.meterColorOverrides ?? {}) }`**, then write **`--ui-color-*`** from `finalColors`. **`meterColorOverrides` shape**: a **partial object with the same keys as the bridge return type**; values are CSS **`<color>`** strings. Omitted keys keep bridge defaults.

4. **Typography scale is global** — Font sizes / `--ui-fs-*` (and related) are **not duplicated per `themeId`**; they live in a single layout/typography configuration applied by **`applyLayout`** (or equivalent).

5. **Layout is orthogonal to theme** — Splitter spacing, min-heights, insets, and other **`--ui-*` layout variables** do **not** vary with `themeId`. If a future “compact density” preset is needed, model it as a separate **`layoutPresetId`** (or similar), not as part of colour themes.

6. **Persistence** — One **JSON blob** under **`layoutPersistKey === "audiometer.ui"`** in code (`src/preferences/data.js`). When the persisted shape changes, the key string may change again (**no migration** from older keys during solo dev). Do **not** embed version suffixes like `v2` in the key name. Fields include at least:
   - **`appearance`**: `"system"` | `"fixed"`.
   - **`themeId`**: required when `appearance === "fixed"`; **omit or `null` when `appearance === "system"`** (resolved theme is computed at runtime, not stored as a fixed choice).
   - **UX when switching `system` → `fixed`**: Settings (or equivalent) **must initialise `themeId` to the currently resolved theme** (`resolveThemeId` / same helper used for `applyTheme` at that moment), **not** blindly `audiometer-dark`, so the UI does not jump unless the user picks another id.

7. **`--chart-1`…`--chart-5`** — Come **only** from the active theme’s **`semantic.chart1`…`semantic.chart5`** (after `applyShadcnSemanticTokensToDocument`). **Do not** copy product curve colours into these slots. **`--ui-chart-*`** remain the source of truth for SVG paths (live/snap and multiple traces). Tailwind **`text-chart-*` / `bg-chart-*`** are **decorative palette slots**, not guaranteed to match a specific trace.

8. **`color-scheme`** — Each theme declares **`colorScheme: "light" | "dark"`** (browser hint for native controls/scrollbars). This is **not** the same as Tailwind `dark:` / `.dark`.

9. **First paint** — Keep the **simple strategy**: static CSS (**`src/generated/theme-fallbacks.css`**, produced by **`npm run theme:generate`**) provides **one placeholder token set** that matches the **builtin `audiometer-dark` semantic palette** (same source module the runtime uses for that id — **no separate “old .dark preset” naming** in the generator). Until JS runs, **`data-theme` may be absent**; after `applyTheme`, set **`data-theme="<resolvedThemeId>"`**. Do **not** pre-generate static CSS for every builtin theme in v1.

10. **Root marker** — Set **`data-theme="<themeId>"`** on `<html>` (or document root) for debugging and for any attribute-scoped CSS in the future.

11. **Apply order and split boundary** — On boot and when saving settings: **`applyLayoutToDocument(prefs)` first**, then **`applyThemeToDocument(resolvedThemeId)`**. Split **by token kind**, not by file count:
    - **`applyLayoutToDocument`**: everything that is **spatial / typographic / non-palette product tuning** from the shared prefs object: **`--ui-font-sans`**, all **`--ui-fs-*`**, **`--ui-fw-*`**, **`--radius`** and **`--ui-radius-*`** (from `prefs.radii`), shell/splitter/article/header/footer **lengths**, **`--ui-min-h-*`**, **`--ui-w-*`**, **`--ui-*-gap`**, **`--ui-*-inset`**, **`--ui-*-pad`**, chart **geometry** (stroke **widths**, dash strings, opacity **numbers** where not a `<color>`), **`--ui-loudness-history-grid-line`** only if it remains a derived non-theme string (prefer moving colour-mix lines to theme when possible), **`--ui-spectrum-grid-v` / `-h`** (numeric opacities from prefs), **`--ui-metric-row-*` lengths**, etc. **Does not** set **`--ui-meter-grad-*`** (Peak gradient is theme-owned — Decision 2).
    - **`applyThemeToDocument`**: **`data-theme`**, **`color-scheme`**, **`applyShadcnSemanticTokensToDocument(semantic)`**, **`mergeMeterColors` → `--ui-color-*`**, **`--ui-chart-*`** from the theme’s **`charts`**, **`--ui-meter-grad-*`** from the theme’s **`meterGradient`**, and any other **theme-owned** colour strings. **Does not** set radii or layout lengths.

12. **`appearance === "system"` resolution (v1)** — Hard-code: OS prefers light → **`audiometer-light`**, prefers dark → **`audiometer-dark`**. No user-configurable system mapping in v1.

13. **`themeId` registry** — **Controlled list** of ids in code; unknown ids from storage **fall back to `audiometer-dark`** and **`console.warn` only in development** (`import.meta.env.DEV`). **Registry location (recipe for adding a theme)**:
    - **Module**: e.g. **`src/theme/builtinThemes.js`** (name may vary; keep **one** registry module).
    - **Exports** (illustrative): **`ThemeId`** (JSDoc typedef union of string literals), **`THEME_IDS`** (frozen array of all valid ids), **`BUILTIN_THEMES`** (`Record<ThemeId, BuiltinTheme>`), **`isThemeId(unknown)`**, **`getBuiltinTheme(id)`**.
    - **`BuiltinTheme` shape**: `{ id: ThemeId, semantic: ShadcnSemantic, charts: ChartsBundle, meterGradient: MeterGradient, colorScheme: "light" | "dark", meterColorOverrides?: Partial<BridgeOutput> }` where **`ChartsBundle`** is the loudness/vector/spectrum chart stroke object shape used today for **`--ui-chart-*`**, and **`MeterGradient`** matches **`{ top, mid, midStopPercent, bottom }`** as today’s peak gradient config.

14. **Float vs main window** — **Same `layoutPersistKey`**, **same resolution rules**, both listen for **`prefers-color-scheme`** when `appearance === "system"`. **Concurrency**: `localStorage` for a given origin is **shared** across WebViews; **last write wins** at the storage API level. **Mitigations (v1)**:
    - **Read–merge–write**: never replace the whole blob without reading the latest JSON first; merge only the keys being updated (layout vs theme fields).
    - **`storage` event**: already used for channel layout — extend the same pattern so a theme change in one window triggers **re-read + `applyTheme`** in others where applicable.
    - **No “main window authoritative” IPC in v1** unless product later requires it; document that **simultaneous Settings edits in two windows** can race.

## Consequences

- ADR 0001 must be read together with this ADR; **§4 of ADR 0001** (runtime overwrite of `--chart-*` from resolved charts) is **replaced** by Decision 7 above (remove **`resolvedChartsToShadcnChartCssVars`** from the apply path and delete the helper/tests once unused).
- New themes require maintaining **`semantic` + `charts` + `meterGradient`** in full; tooling or copy-from-template is optional follow-up.

## Alternatives considered

- **Persist resolved `themeId` under `system`**: rejected — would go stale when the OS theme toggles unless continuously rewritten.
- **Per-theme layout / typography in the theme bundle**: rejected for v1 — unnecessary duplication until a real “compact” product requirement exists.
- **Pre-generated CSS for every theme at first paint**: rejected for v1 — higher build complexity for marginal gain while solo-developing.
