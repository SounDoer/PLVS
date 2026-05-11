# ADR 0001: Keep layout in `--ui-*`, use shadcn/Tailwind for surfaces

## Status

Accepted

## Context

AudioMeter injects many CSS custom properties from `applyUiPreferencesToDocument` (`src/preferences/applyDocumentTheme.js`, exported via `uiPreferences.js`): spacing, radii, chart stroke colours (`--ui-chart-*`), and meter-specific colours bridged from the shadcn semantic palette (`meterColorBridge`). The UI also uses Tailwind v4 + shadcn tokens (`bg-muted`, `border-border`, `text-chart-*`, etc.). First-paint shadcn variables are generated into `src/generated/theme-fallbacks.css` from `AUDIOMETER_SEMANTIC_*` (`npm run theme:generate`, wired to `prebuild`).

## Decision

1. **Layout and chart geometry** stay on injected `--ui-*` variables (rem/px, min-heights, gaps, SVG padding). They are product-tuned and are not duplicated into `@theme` to avoid two sources of truth.
2. **Surfaces and copy hierarchy** in React panels prefer shadcn semantics: `bg-muted` for chart insets, `border-border`, `bg-secondary`, `text-muted-foreground`, and `text-chart-*` where a chart-adjacent accent is needed without tying to a specific SVG stroke.
3. **SVG strokes** continue to use `--ui-chart-*` resolved per theme via `getResolvedCharts`, so theme editors and modules control the exact path colours.
4. **Tailwind chart utilities** map to `--chart-1`…`--chart-5` via `@theme inline` in `src/index.css` (`--color-chart-*`). After `applyShadcnSemanticTokensToDocument`, **`resolvedChartsToShadcnChartCssVars`** overwrites `--chart-*` from `getResolvedCharts` so `text-chart-*` / `bg-chart-*` track the same resolved product strokes as the main traces (momentary → short-term → vectorscope live → spectrum live → selection), while SVG paths still use `--ui-chart-*` (including snap variants).

## Consequences

- Panel JSX may mix `bg-muted` with `stroke="var(--ui-chart-…)"` in the same view; that is intentional.
- Snap / secondary trace colours are not mapped into the five `--chart-*` slots; decorative UI that must match snap strokes should keep using `--ui-chart-*` or explicit CSS variables.

## Alternatives considered

- **Move all layout into `@theme`**: rejected — large surface area, easy drift from `UI_PREFERENCES` JS object, and weaker story for per-module overrides.
- **Drop `--ui-chart-*` and use only `--chart-*`**: rejected — product needs distinct strokes per trace (momentary vs short-term, live vs snap) beyond five generic chart slots without overloading semantics.
