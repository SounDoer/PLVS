# Design Token Specification

AudioMeter UI token system — established from design review, May 2026.  
Implement via `src/preferences/data.js` + `src/preferences/applyDocumentTheme.js`.  
Color themes live in `src/theme/builtinThemes.js`.

---

## Architecture

Three layers. Components consume **Semantic** (shadcn) or **Component** tokens only — never raw palette values.

```
Palette      Raw hex / oklch values. Lives in builtinThemes.js and shadcnSemanticPreset.js.
             Not exposed as tokens. Reference only.

Semantic     shadcn-standard CSS variables (--background, --primary, --muted-foreground, etc.)
             Written by applyShadcnSemanticTokensToDocument().
             Used directly by shadcn components and Tailwind semantic utilities.

Component    AudioMeter-specific --ui-* tokens with no shadcn equivalent.
             Written by applyThemeToDocument() and applyLayoutToDocument().
             Split into sub-namespaces: typography, spacing, radius, dataviz.
```

---

## Color Tokens

### Shadcn Semantic (use directly in components)

| Token | Role |
|-------|------|
| `--background` | Page background |
| `--foreground` | Primary text |
| `--card` | Panel surface |
| `--card-foreground` | Text on panels |
| `--primary` | Brand accent (cyan dark / blue light) |
| `--primary-foreground` | Text on primary |
| `--secondary` | Secondary surface / chart inset bg |
| `--muted` | Muted surface |
| `--muted-foreground` | Secondary / muted text |
| `--accent` | Accent surface |
| `--border` | Borders and dividers |
| `--input` | Input field border |
| `--ring` | Focus ring |
| `--destructive` | Error / danger state |
| `--radius` | Base border radius (card level) |

Do **not** create `--ui-color-*` aliases for any of the above.

### Component: Meter (peak bar gradient)

Controls the three-stop gradient fill on Peak panel channel bars.

| Token | Role |
|-------|------|
| `--ui-meter-grad-top` | Top colour (red, clip zone) |
| `--ui-meter-grad-mid` | Mid colour (amber, warning zone) |
| `--ui-meter-grad-mid-stop` | Mid stop position (e.g. `46%`) |
| `--ui-meter-grad-bottom` | Bottom colour (green, safe zone) |

### Component: Chart (data trace colours)

All chart traces use a **live / snap** dual-rail pattern.  
`live` = real-time input. `snap` = frozen history snapshot.

| Token | Role |
|-------|------|
| `--ui-chart-momentary` | Loudness history — momentary curve (live) |
| `--ui-chart-momentary-snap` | Loudness history — momentary curve (snap) |
| `--ui-chart-shortterm` | Loudness history — short-term curve (live) |
| `--ui-chart-shortterm-snap` | Loudness history — short-term curve (snap) |
| `--ui-chart-selection` | Loudness history — selected-offset line |
| `--ui-chart-vectorscope-live` | Vectorscope path (live) |
| `--ui-chart-vectorscope-snap` | Vectorscope path (snap) |
| `--ui-chart-spectrum-live` | Spectrum path + fill (live) |
| `--ui-chart-spectrum-snap` | Spectrum path + fill (snap) |

### Component: Signal (semantic state colours)

Values that carry a pass/warn/fail meaning, not just chart traces.

| Token | Role |
|-------|------|
| `--ui-signal-corr-bad` | Correlation — negative / out of phase |
| `--ui-signal-corr-mid` | Correlation — neutral |
| `--ui-signal-corr-good` | Correlation — in phase |
| `--ui-signal-peak-sample` | Peak hold line — sample peak |
| `--ui-signal-peak-true` | Peak hold line — true peak |
| `--ui-signal-tp-max` | TP MAX value text when exceeded |

> **Migration:** `--ui-color-corr-*` → `--ui-signal-corr-*`, `--ui-color-peak-*` → `--ui-signal-peak-*`, `--ui-color-tp-max` → `--ui-signal-tp-max`. Remove all `--ui-color-*` aliases that duplicate a shadcn semantic token.

---

## Typography Tokens

Font family: **Inter** for all UI text. **JetBrains Mono** for every numeric value.

```css
--ui-font-sans: "Inter", system-ui, sans-serif;
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace;
```

Apply `font-[family-name:var(--ui-font-mono)] tabular-nums` to **all** live-changing numeric displays: metric values, axis tick numbers, peak channel values, correlation, TP MAX, HUD values.

### Text Roles and Sizes

Seven roles. Each has its own token — do not share tokens between roles even when sizes happen to match.

| # | Role | Token | Size | Weight | Notes |
|---|------|-------|------|--------|-------|
| 1 | **App Title** | `--ui-fs-app-title` | 16px | 800 | "AudioMeter" in header. Settings panel title also uses this token. |
| 2 | **Panel Title** | `--ui-fs-panel-title` | 12px | 600 | CardTitle in each panel. Muted foreground colour. |
| 3 | **Axis Annotation** | `--ui-fs-axis` | 11px | 400 | Static chart scale labels: dB ticks, freq labels, LUFS Y-axis, time axis. Muted. |
| 4 | **Dynamic Display** | `--ui-fs-display` | 13px | — | Live values overlaid on charts: channel labels, TP MAX, correlation, vectorscope corner labels, HUD tooltip content. Label: muted. Value: mono + semibold + signal colour. |
| 5a | **Metric Annotation** | `--ui-fs-metric-meta` | 12px | 500 | Loudness metric row label + unit (merged — same style, left/right alignment only differs). Uppercase + tracking. |
| 5b | **Metric Value** | `--ui-fs-metric-value` | 20px | 600 | Loudness metric row numeric value. Mono + tabular-nums. |
| 6 | **Status** | `--ui-fs-status` | 11px | 400 | Footer status bar text. Muted. |
| 7 | **Controls** | `--ui-fs-controls` | 14px | — | Buttons (semibold), settings form labels (medium), select options, help popover items. |

> **Migration:** `--ui-fs-section` → `--ui-fs-panel-title`, `--ui-fs-axis-value` + `--ui-fs-axis-unit` → `--ui-fs-axis`, `--ui-fs-extra` → `--ui-fs-display`, `--ui-fs-action` → `--ui-fs-controls`. Drop `--ui-fs-settings-heading` (use `--ui-fs-panel-title`).

---

## Spacing Tokens

Six namespaces matching the six structural regions of the UI.  
Property vocabulary: `pad-x` / `pad-y` / `pad`, `gap`, `inset`, `min-h`, `w`.

### Shell

```
--ui-shell-max-w          Max content width (1600px)
--ui-shell-pad            Outer padding — base breakpoint
--ui-shell-pad-lg         Outer padding — lg breakpoint
--ui-shell-gap            Vertical gap between regions — base
--ui-shell-gap-lg         Vertical gap between regions — lg
```

### Header

```
--ui-header-pad-x         Horizontal padding
--ui-header-pad-y         Vertical padding
--ui-header-action-gap    Gap between action buttons (Clear / START / Settings)
```

### Footer

```
--ui-footer-pad-x         Horizontal padding
--ui-footer-pad-y         Vertical padding
```

### Panel

```
--ui-panel-pad-x          Horizontal padding inside each Card panel
--ui-panel-pad-y          Vertical padding inside each Card panel
--ui-panel-title-gap      Gap between panel title and panel body
--ui-panel-footer-gap     Gap between chart area and inline info row below it
--ui-panel-gap            Gap between sibling panels (splitter region size)
```

#### Panel → Chart (sub-namespace)

```
--ui-chart-pad            SVG horizontal padding inside chart container
--ui-chart-inset-top      Top inset within chart display area (unified across all panels)
--ui-chart-inset-bottom   Bottom inset within chart display area (unified across all panels)
--ui-chart-axis-gap       Gap between axis label column and chart area
--ui-chart-hud-inset      Inset for floating HUD / tooltip boxes
```

> **Migration:** `--ui-article-pad-x/y` → `--ui-panel-pad-x/y`, `--ui-section-title-gap` → `--ui-panel-title-gap`, `--ui-section-gap` → `--ui-panel-gap`, `--ui-spectrum-svg-pad` / `--ui-history-svg-pad` → `--ui-chart-pad`, `--ui-*-display-top-inset` → `--ui-chart-inset-top` (single unified value), `--ui-axis-gap-x` / `--ui-axis-gap-y` → `--ui-chart-axis-gap`, `--ui-hud-inset` → `--ui-chart-hud-inset`.

### Metric Row

```
--ui-metric-row-pad-x     Horizontal padding inside each metric row
--ui-metric-row-pad-y     Vertical padding inside each metric row
--ui-metric-row-gap       Gap between sibling metric rows
--ui-metric-row-min-h     Minimum row height
--ui-metric-title-gap     Gap between metrics section title and first row
--ui-metric-list-gap      Gap managed by the scroll container (same as row-gap in most cases)
--ui-metric-inline-gap    Gap between inline label + value pairs (e.g. "CORRELATION  0.94")
```

> **Migration:** `--ui-metrics-title-gap` → `--ui-metric-title-gap`, `--ui-metrics-list-gap` → `--ui-metric-list-gap`, `--ui-inline-value-gap` → `--ui-metric-inline-gap`.

### Modal

```
--ui-modal-pad            Inner padding of the Settings sheet
--ui-modal-gap            Gap between settings sections
--ui-modal-header-gap     Gap between modal title and first section
--ui-modal-action-pad-x   Horizontal padding on action buttons within modal
--ui-modal-action-pad-y   Vertical padding on action buttons within modal
```

> **Migration:** `--ui-settings-modal-*` → `--ui-modal-*`.

---

## Radius Tokens

```
--radius                  Base card-level radius (shadcn native, 0.625rem). Use directly.
--ui-radius-modal         Overlay / sheet radius (1rem)
--ui-radius-pill          Full-round pill (9999px)
--ui-radius-metric-row    Metric row inner radius (0.375rem)
```

> **Migration:** Remove `--ui-radius-card`. Replace all `var(--ui-radius-card)` usages with `var(--radius)`.

---

## Retired Tokens (remove on implementation pass)

All `--ui-color-*` tokens that duplicate a shadcn semantic:

```
--ui-color-page-bg          → var(--background)
--ui-color-text-primary     → var(--foreground)
--ui-color-text-secondary   → var(--muted-foreground)
--ui-color-text-muted       → var(--muted-foreground)
--ui-color-text-subtle      → var(--muted-foreground)
--ui-color-panel-bg         → var(--card)
--ui-color-panel-bg-splitter→ var(--secondary)
--ui-color-inset-bg         → var(--muted)
--ui-color-border-default   → var(--border)
--ui-color-divider          → var(--border)
--ui-color-brand            → var(--primary)
--ui-color-brand-light      → var(--ring)
--ui-color-brand-hover      → var(--ring)
--ui-color-control-bg       → var(--accent)
```

Also retire: `--ui-fs-section`, `--ui-fs-axis-value`, `--ui-fs-axis-unit`, `--ui-fs-extra`, `--ui-fs-action`, `--ui-fs-settings-heading`, `--ui-radius-card`, `--ui-article-pad-*`, `--ui-section-*`, `--ui-settings-modal-*`, `--ui-axis-gap-*`, all per-panel `--ui-*-display-*-inset` variants, `--ui-spectrum-svg-pad`, `--ui-history-svg-pad`, `--ui-hud-inset`, `--ui-metrics-*`, `--ui-inline-value-gap`.
