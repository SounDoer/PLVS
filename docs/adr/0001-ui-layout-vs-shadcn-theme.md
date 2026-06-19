# ADR 0001: Keep layout in `--ui-*`, use shadcn/Tailwind for surfaces

## Status

Accepted

## Context

AudioMeter injects many CSS custom properties from `applyLayoutToDocument` / `applyThemeToDocument` (`src/preferences/applyDocumentTheme.js`, exported via `uiPreferences.js`): spacing, radii, chart geometry, and seed-derived instrument colours (`--ui-loudness-*`, `--ui-spectrum-*`, `--ui-vectorscope-*`, `--ui-waveform-*`, `--ui-signal-*`, `--ui-meter-gradient-*`). The UI also uses Tailwind v4 + shadcn tokens (`bg-muted`, `border-border`, `text-chart-*`, etc.). First-paint shadcn variables are generated into `src/generated/theme-fallbacks.css` from `PLVS_SEMANTIC_*` (`npm run theme:generate`, wired to `prebuild`). **Theme identity (`themeId`, appearance, no `.dark` axis) and how `--chart-*` relate to curves** are defined in **[ADR 0002](0002-theme-id-and-appearance.md)**.

## Decision

1. **Layout and chart geometry** stay on injected `--ui-*` variables (rem/px, min-heights, gaps, SVG padding). They are product-tuned and are not duplicated into `@theme` to avoid two sources of truth.
2. **Surfaces and copy hierarchy** in React panels prefer shadcn semantics: `bg-muted` for chart insets, `border-border`, `bg-secondary`, `text-muted-foreground`, and `text-chart-*` where a chart-adjacent accent is needed without tying to a specific SVG stroke.
3. **SVG strokes** continue to use product-specific **instrument tokens** (`--ui-loudness-*`, `--ui-spectrum-*`, `--ui-vectorscope-*`, `--ui-waveform-*`), sourced from the active theme's seeds through `buildThemeTokens()` (see ADR 0002), so each theme controls live/snap variants without overloading shadcn chart slots.
4. **Tailwind chart utilities** map to `--chart-1`…`--chart-5` via `@theme inline` in `src/index.css` (`--color-chart-*`). Those variables follow **shadcn `semantic.chart1`…`chart5` only** — they are **not** mirrored from product curve strokes; see ADR 0002 Decision 7.

## Consequences

- Panel JSX may mix `bg-muted` with `stroke="var(--ui-loudness-momentary)"` or another instrument token in the same view; that is intentional.
- Decorative `text-chart-*` uses the five semantic chart slots; UI that must match a specific trace (including snap) should use the corresponding instrument token or explicit variables.

## Alternatives considered

- **Move all layout into `@theme`**: rejected — large surface area, easy drift from `UI_PREFERENCES` JS object, and weaker story for per-module overrides.
- **Use only `--chart-*`**: rejected — product needs distinct strokes per trace (momentary vs short-term, live vs snap) beyond five generic chart slots without overloading semantics.
