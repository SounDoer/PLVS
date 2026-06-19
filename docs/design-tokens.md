# Design Token Specification

PLVS UI token system — established from design review, May 2026.  
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

Component    PLVS-specific --ui-* tokens with no shadcn equivalent.
             Written by applyThemeToDocument() and applyLayoutToDocument().
             Split into sub-namespaces: typography, spacing, radius, dataviz.
```

---

## Color Tokens

### Shadcn Semantic

Current PLVS Dark values:

| Token                      | Value                               | Role                                |
| -------------------------- | ----------------------------------- | ----------------------------------- |
| `--background`             | `oklch(0.13 0.01 55)` ≈ `#131110`   | Page background — deepest warm gray |
| `--foreground`             | `oklch(0.96 0.006 70)` ≈ `#f5f0ea`  | Primary text — warm white           |
| `--card`                   | `oklch(0.195 0.012 50)` ≈ `#1e1b17` | Panel surface                       |
| `--card-foreground`        | same as `--foreground`              | Text on panels                      |
| `--popover`                | same as `--card`                    | Popover background                  |
| `--popover-foreground`     | same as `--foreground`              | Popover text                        |
| `--primary`                | `#fb923c`                           | Brand color — orange                |
| `--primary-foreground`     | `oklch(0.13 0.01 55)`               | Text on primary buttons             |
| `--secondary`              | `oklch(0.258 0.012 50)`             | Secondary surface                   |
| `--secondary-foreground`   | same as `--foreground`              | Text on secondary surface           |
| `--muted`                  | same as `--secondary`               | Muted surface                       |
| `--muted-foreground`       | `oklch(0.63 0.015 55)` ≈ `#9e9488`  | Secondary / muted text              |
| `--accent`                 | same as `--secondary`               | Accent surface                      |
| `--accent-foreground`      | same as `--foreground`              | Text on accent surface              |
| `--border`                 | `oklch(1 0 0 / 9%)`                 | Borders and dividers                |
| `--input`                  | `oklch(1 0 0 / 14%)`                | Input field border                  |
| `--ring`                   | `#fb923c`                           | Focus ring — matches brand color    |
| `--destructive`            | `oklch(0.65 0.22 25)`               | Error / danger state                |
| `--destructive-foreground` | `oklch(0.985 0 0)`                  | Text on destructive                 |
| `--radius`                 | `0.625rem`                          | Base border radius (card level)     |

Do **not** create `--ui-*` aliases for any of the above — use the shadcn tokens directly.

### Component: Meter (peak bar gradient)

Controls the three-stop gradient fill on Peak panel channel bars.

| Token                          | Value     | Role                      |
| ------------------------------ | --------- | ------------------------- |
| `--ui-meter-gradient-top`      | `#f97373` | Clip zone (red)           |
| `--ui-meter-gradient-mid`      | `#fbbf24` | Warning zone (amber)      |
| `--ui-meter-gradient-mid-stop` | `46%`     | Gradient transition point |
| `--ui-meter-gradient-bottom`   | `#34d399` | Safe zone (green)         |

### Component: Instrument Traces

Instrument traces are derived from a small theme seed set in `src/theme/buildThemeTokens.js`:
`accent`, `accentSecondary`, and `signal.{good,warn,bad}`. Components consume only the generated
`--ui-*` tokens below.

For Loudness history, `Momentary` and `Short-term` are equally important primary data series. They should be distinguishable without making one read as secondary and without borrowing dashed-line semantics from future marker layers. `Momentary` uses the thinner stroke and `Short-term` uses the thicker stroke. These stroke widths should render as screen-space stroke widths, not be visually compressed by SVG viewBox scaling. Theme authors may tune their lightness, saturation, slight hue shift, opacity, or stroke width per theme, but the pair should still feel related to Spectrum / Vectorscope accent colors rather than introducing a Loudness-only palette.

Snapshot colors are state colors for selected historical data. Within a theme, loudness,
vectorscope, and spectrum snap tokens should belong to one snapshot family. Do not treat snapshot
colors as new data categories, hover colors, or warning colors.

Waveform lanes use a **stroke + fill** pattern: 1px strokes on both the max (top) and min (bottom)
envelope edges, plus a global semi-transparent fill opacity. The waveform has no snap variant
because it always displays the currently visible time window without overlaying a second frozen trace.

The Loudness `Reference` layer is not drawn as a line or band. Instead, the reference LUFS drives an
**over-reference gradient** on the `M` and `ST` traces. The reference value is not shown as a
dedicated Y-axis tick.

| Token                          | Value            | Role                                    |
| ------------------------------ | ---------------- | --------------------------------------- |
| `--ui-loudness-momentary`      | `#fb923c`        | Loudness M live primary data trace      |
| `--ui-loudness-momentary-snap` | `#fcd34d`        | Loudness M snapshot trace               |
| `--ui-loudness-momentary-over` | `#ff5a1f`        | Loudness M over-reference shade         |
| `--ui-loudness-shortterm`      | `#c66a2a`        | Loudness ST live sibling data trace     |
| `--ui-loudness-shortterm-snap` | `#f2b27a`        | Loudness ST snapshot sibling trace      |
| `--ui-loudness-shortterm-over` | `#ff4a0a`        | Loudness ST over-reference shade        |
| `--ui-loudness-selection`      | `#fcd34d`        | Selected-offset baseline                |
| `--ui-loudness-grid`           | `color-mix(...)` | Loudness and waveform grid lines        |
| `--ui-vectorscope-trace`       | `#fb923c`        | Vectorscope path (live)                 |
| `--ui-vectorscope-trace-snap`  | `#fcd34d`        | Vectorscope path (snap)                 |
| `--ui-vectorscope-grid-stroke` | `color-mix(...)` | Vectorscope axis and grid strokes       |
| `--ui-spectrum-primary`        | `#fb923c`        | Spectrum primary path + fill            |
| `--ui-spectrum-primary-snap`   | `#fcd34d`        | Spectrum primary snapshot path + fill   |
| `--ui-spectrum-secondary`      | `#38bdf8`        | Spectrum secondary path + fill          |
| `--ui-spectrum-secondary-snap` | `#7dd3fc`        | Spectrum secondary snapshot path + fill |
| `--ui-waveform-trace`          | `#fb923c`        | Waveform envelope stroke + fill         |

### Component: Signal (semantic state colors)

Values that carry a pass/warn/fail meaning — not brand-derived.

| Token                     | Value     | Role                            |
| ------------------------- | --------- | ------------------------------- |
| `--ui-signal-peak-sample` | `#fb923c` | Peak hold line — sample peak    |
| `--ui-signal-tp-max`      | `#f97373` | TP MAX value text when exceeded |

### Component: Spectrogram Colormap

The spectrogram uses a per-theme ordered stop list, not a CSS variable.
`src/theme/builtinThemes.js` owns the `colormap` field, and
`src/theme/spectrogramColormap.js` builds the 256-entry LUT consumed by
`useSpectrogramCanvas()`. The colormap is reserved for area/density visuals; 1D traces keep using
the instrument tokens above.

---

## Typography Tokens

Two font families:

```css
--ui-font-sans: "Inter", system-ui, sans-serif;
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace;
```

**Rule:** All live-changing numeric displays use `--ui-font-mono` + `tabular-nums`. Static UI text uses `--ui-font-sans`.

### Text Roles and Sizes

| #   | Role                  | Token                  | Size | Weight | Notes                                                                         |
| --- | --------------------- | ---------------------- | ---- | ------ | ----------------------------------------------------------------------------- |
| 1   | **App Title**         | `--ui-fs-app-title`    | 16px | 800    | "PLVS" in header.                                                             |
| 2   | **Panel Title**       | `--ui-fs-panel-title`  | 12px | 600    | CardTitle in each panel and the Settings panel title. Muted foreground color. |
| 3   | **Axis Annotation**   | `--ui-fs-axis`         | 11px | 400    | Static chart scale labels: dB ticks, freq labels, time axis. Muted.           |
| 4   | **Dynamic Display**   | `--ui-fs-display`      | 13px | —      | Live values overlaid on charts: channel labels, TP MAX, correlation.          |
| 5a  | **Metric Annotation** | `--ui-fs-metric-meta`  | 12px | 500    | Loudness metric row label + unit. Uppercase + tracking.                       |
| 5b  | **Metric Value**      | `--ui-fs-metric-value` | 20px | 600    | Loudness metric row numeric value. Mono + tabular-nums.                       |
| 6   | **Status**            | `--ui-fs-status`       | 11px | 400    | Footer status bar text. Muted.                                                |
| 7   | **Controls**          | `--ui-fs-controls`     | 14px | —      | Buttons (semibold), form labels (medium).                                     |

---

## Spacing Tokens

Six namespaces matching the six structural regions of the UI.  
Property vocabulary: `pad-x` / `pad-y` / `pad`, `gap`, `inset`, `min-h`, `w`.

### Shell

```
--ui-shell-max-w     1600px   Max content width
--ui-shell-pad       0.8rem   Outer padding — base breakpoint
--ui-shell-pad-lg    1.2rem   Outer padding — lg breakpoint
--ui-shell-gap       0.55rem  Vertical gap between regions — base
--ui-shell-gap-lg    0.6rem   Vertical gap between regions — lg
```

### Header

```
--ui-header-pad-x       0.9rem    Horizontal padding
--ui-header-pad-y       0.55rem   Vertical padding
--ui-header-action-gap  0.35rem   Gap between action buttons
```

### Footer

```
--ui-footer-pad-x    1rem     Horizontal padding
--ui-footer-pad-y    0.65rem  Vertical padding
```

### Panel

```
--ui-panel-pad-x          0.7rem    Horizontal padding inside each Card panel
--ui-panel-pad-y          0.5rem    Vertical padding inside each Card panel
--ui-panel-title-gap      0.4rem    Gap between panel title and panel body
--ui-panel-footer-gap     0.4rem    Gap between chart area and inline info row below it
--ui-panel-gap            0.55rem   Gap between sibling panels — = --ui-shell-gap (unified rhythm)
--ui-splitter-bar-thickness  1px    Visual width of draggable splitter bar
```

#### Panel → Chart (sub-namespace)

```
--ui-chart-pad           0.4rem  SVG horizontal padding inside chart container
--ui-chart-inset-top     0.5rem  Top inset within chart display area
--ui-chart-inset-bottom  0rem    Bottom inset within chart display area
--ui-chart-axis-gap      0.4rem  Gap between axis label column and chart area
--ui-chart-hud-inset     0.25rem Inset for floating HUD / tooltip boxes
```

### Metric Row

```
--ui-metric-row-pad-x   0.5rem    Horizontal padding inside each metric row
--ui-metric-row-pad-y   0.375rem  Vertical padding inside each metric row
--ui-metric-row-gap     0.5rem    Gap between sibling metric rows
--ui-metric-row-min-h   2.5rem    Minimum row height
--ui-metric-title-gap   0.4rem    Gap between metrics section title and first row
--ui-metric-list-gap    0.2rem    Gap managed by the scroll container
--ui-metric-inline-gap  0.4rem    Gap between inline label + value pairs
```

### Modal

```
--ui-modal-pad           1.25rem  Inner padding of the Settings sheet
--ui-modal-gap           1rem     Gap between settings sections
--ui-modal-header-gap    1.25rem  Gap between modal title and first section
--ui-modal-action-pad-x  0.75rem  Horizontal padding on action buttons
--ui-modal-action-pad-y  0.25rem  Vertical padding on action buttons
```

---

## Radius Tokens

```
--radius                  0.625rem  Base card-level radius (shadcn native). Use directly.
--ui-radius-modal         1rem      Sheet / overlay radius
--ui-radius-pill          9999px    Full-round pill (Badge, etc.)
--ui-radius-metric-row    0.375rem  Metric row inner radius
```

---

## Text Casing Conventions

Displayed UI text follows four casing rules (standardized 2026-06-13). Casing lives in the
source strings, **not** in CSS `text-transform` — avoid `uppercase`/`capitalize` utility classes,
which fight the source strings and don't change DOM `textContent`.

| Casing                                  | Used for                                                                                                                                                                               | Examples                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **ALL CAPS**                            | Live state / transport chips only — read as indicator lights                                                                                                                           | `StatusPill` (READY/LIVE/SNAP), `TransportButton` (START/STOP/LIVE) |
| **Title Case** (minor words lowercased) | Everything else informational: panel titles, metric names, meter captions, menu section headers, footer labels, settings rows + options, shortcut descriptions, tooltips, placeholders | `TP Max`, `Correlation`, `Open at Login`, `Save as Preset…`         |
| **Sentence case**                       | Full sentences / messages: status text, empty states, error & help text, gesture hints                                                                                                 | `Up to date`, `No stats selected`, `Combo unavailable, try another` |
| **Canonical**                           | Acronyms & units keep their standard form                                                                                                                                              | LUFS, LU, dB, %, LRA, PSR, PLR, TP, L/R/C/LFE                       |

Minor words (a, an, the, and, or, at, to, of, on, for, in, by, vs, via…) stay lowercase in Title
Case unless they are the first or last word. Screen-reader-only `aria-label`s are not "displayed
text" and are exempt.
