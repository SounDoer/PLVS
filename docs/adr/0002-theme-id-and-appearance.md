# ADR 0002: Theme id, appearance, and token pipeline

## Status

Accepted

## Context

AudioMeter will support **multiple named colour themes** (not only built-in light/dark pairs). The UI must stay aligned with **shadcn-style semantic CSS variables** and Tailwind v4, while keeping **layout and typography** easy to tune without duplicating them per theme. Persistence is required during development and for production (layout, splitter ratios, etc.); **custom colour packs** are explicitly **out of scope for now** (may revisit later).

This ADR supersedes the following earlier ideas where they conflict with ADR 0001 §4: **`--chart-1`…`--chart-5` are not overwritten from product chart strokes**; they follow **semantic `chart1`…`chart5` only** (see Decision 7).

## Decision

1. **Single dimension of colour context** — **`themeId` only**. Do **not** use a second axis such as `.dark` on `<html>` or Tailwind `dark:` to mean “theming”. Colours come from the **active resolved theme**. (Removing `@custom-variant dark` / `.dark` is part of the implementation; existing components already rely mostly on semantic tokens.)

2. **Builtin themes are self-contained** — Each registered **`themeId`** ships a **full** token bundle: at least **`semantic`** (shadcn-shaped surface tokens) and **`charts`** (all module stroke/fill inputs that today feed `--ui-chart-*`). **No runtime merge** with separate “module default charts”; copying defaults when authoring a new theme is acceptable.

3. **`buildMeterColorBridge(semantic)`** — **One shared bridge** maps `semantic` → legacy **`--ui-color-*`** for metering chrome and mixed SVG/auxiliary colours. Per-theme exceptions use a small optional **`meterColorOverrides`** object merged on top of the bridge output.

4. **Typography scale is global** — Font sizes / `--ui-fs-*` (and related) are **not duplicated per `themeId`**; they live in a single layout/typography configuration applied by **`applyLayout`** (or equivalent).

5. **Layout is orthogonal to theme** — Splitter spacing, min-heights, insets, and other **`--ui-*` layout variables** do **not** vary with `themeId`. If a future “compact density” preset is needed, model it as a separate **`layoutPresetId`** (or similar), not as part of colour themes.

6. **Persistence** — One **JSON blob** under a **versioned storage key** (`layoutPersistKey` will change when the schema changes; **no migration** from older keys during solo dev). Fields include at least:
   - **`appearance`**: `"system"` | `"fixed"`.
   - **`themeId`**: required when `appearance === "fixed"`; **omit or `null` when `appearance === "system"`** (resolved theme is computed at runtime, not stored as a fixed choice).

7. **`--chart-1`…`--chart-5`** — Come **only** from the active theme’s **`semantic.chart1`…`semantic.chart5`** (after `applyShadcnSemanticTokensToDocument`). **Do not** copy product curve colours into these slots. **`--ui-chart-*`** remain the source of truth for SVG paths (live/snap and multiple traces). Tailwind **`text-chart-*` / `bg-chart-*`** are **decorative palette slots**, not guaranteed to match a specific trace.

8. **`color-scheme`** — Each theme declares **`colorScheme: "light" | "dark"`** (browser hint for native controls/scrollbars). This is **not** the same as Tailwind `dark:` / `.dark`.

9. **First paint** — Keep the **simple strategy**: static CSS provides **one placeholder theme** aligned with **`audiometer-dark`** until JS runs; then **`applyTheme(resolvedThemeId)`** applies the real theme. Do **not** pre-generate static CSS for every builtin theme in v1.

10. **Root marker** — Set **`data-theme="<themeId>"`** on `<html>` (or document root) for debugging and for any attribute-scoped CSS in the future.

11. **Apply order** — On boot and when saving settings: **`applyLayout` first**, then **`applyTheme(resolvedThemeId)`**, so layout/typography variables exist before colour tokens that might reference them.

12. **`appearance === "system"` resolution (v1)** — Hard-code: OS prefers light → **`audiometer-light`**, prefers dark → **`audiometer-dark`**. No user-configurable system mapping in v1.

13. **`themeId` registry** — **Controlled list** of ids in code; unknown ids from storage **fall back to `audiometer-dark`** and **`console.warn`**.

14. **Float vs main window** — **Same persistence and same resolution rules**; both listen for system colour-scheme changes when `appearance === "system"`.

## Consequences

- ADR 0001 must be read together with this ADR; **§4 of ADR 0001** (runtime overwrite of `--chart-*` from resolved charts) is **replaced** by Decision 7 above.
- Implementing this ADR implies removing **`resolvedChartsToShadcnChartCssVars`** usage from the theme apply path (and deleting or repurposing that helper if unused).
- New themes require maintaining **`semantic` + `charts`** in full; tooling or copy-from-template is optional follow-up.

## Alternatives considered

- **Persist resolved `themeId` under `system`**: rejected — would go stale when the OS theme toggles unless continuously rewritten.
- **Per-theme layout / typography in the theme bundle**: rejected for v1 — unnecessary duplication until a real “compact” product requirement exists.
- **Pre-generated CSS for every theme at first paint**: rejected for v1 — higher build complexity for marginal gain while solo-developing.
