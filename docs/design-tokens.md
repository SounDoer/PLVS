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
             Global tokens are written by applyThemeToDocument() and applyLayoutToDocument().
             Responsive Dock tokens are scoped by src/dock/dockTokens.css because they depend
             on the Dock window viewport height. Sub-namespaces include typography, spacing,
             radius, dataviz, and dock.
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
| `--ui-waveform-trace-snap`     | derived          | Waveform snapshot trace                 |

### Component: Signal (semantic state colors)

Values that carry a pass/warn/fail meaning — not brand-derived.

| Token                     | Value     | Role                            |
| ------------------------- | --------- | ------------------------------- |
| `--ui-signal-peak-sample` | `#fb923c` | Peak hold line — sample peak    |
| `--ui-signal-tp-max`      | `#f97373` | TP MAX value text when exceeded |
| `--ui-signal-bad`         | `#f97373` | General error / clip state      |
| `--ui-signal-warn`        | `#fbbf24` | General warning state           |
| `--ui-signal-good`        | `#34d399` | General safe / healthy state    |

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
--ui-font-sans: "Inter", system-ui, sans-serif; /* set by applyLayoutToDocument */
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace; /* set statically in index.css */
```

**Rule:** All live-changing numeric displays use `--ui-font-mono` + `tabular-nums`. Static UI text uses `--ui-font-sans`.

### Normal-mode Text Roles and Sizes

Normal application surfaces use semantic typography roles instead of fixed Tailwind font-size
utilities or component-local pixel values. Dock is excluded and owns its responsive typography
under `src/dock/dockTokens.css`.

| Role                  | Token                  | Size | Typical use                                                  |
| --------------------- | ---------------------- | ---- | ------------------------------------------------------------ |
| **Caption**           | `--ui-fs-caption`      | 10px | Menu groups, compact metadata, drag/drop overlay labels      |
| **Axis Annotation**   | `--ui-fs-axis`         | 11px | Chart ticks, secondary hints, validation and tooltip text    |
| **Status**            | `--ui-fs-status`       | 11px | Header/footer state and compact status chips                 |
| **Control**           | `--ui-fs-control`      | 12px | Compact buttons, selects, inputs and management rows         |
| **Metric Annotation** | `--ui-fs-metric-meta`  | 12px | Metric names and units                                       |
| **Panel Title**       | `--ui-fs-panel-title`  | 12px | Panel, editor and dialog titles                              |
| **Dynamic Display**   | `--ui-fs-display`      | 13px | Live chart values and settings drawer text                   |
| **Body**              | `--ui-fs-body`         | 14px | General descriptions, empty states and standard UI controls |
| **Metric Value**      | `--ui-fs-metric-value` | 16px | Primary metric values; mono with tabular numerals            |

Relative `em` sizes are allowed inside a semantic parent when they express a local hierarchy.

---

## Spacing Tokens

Property vocabulary: `pad-x` / `pad-y` / `pad`, `gap`, `inset`, `min-h`, `w`.

### Shell

```
--ui-shell-pad       0.3rem    Outer padding
--ui-shell-gap       0.35rem   Vertical gap between regions
```

### Header

```
--ui-header-pad-x       0.4rem    Horizontal padding
--ui-header-pad-y       0.4rem    Vertical padding
--ui-header-action-gap  0.2rem    Gap between action buttons
```

### Footer

```
--ui-footer-pad-x    0.5rem    Horizontal padding
--ui-footer-pad-y    0.4rem    Vertical padding
```

### Panel

```
--ui-panel-pad-x              0.25rem   Horizontal padding inside each Card panel
--ui-panel-pad-y              0.35rem   Vertical padding inside each Card panel
--ui-splitter-bar-thickness   1px       Visual width of draggable splitter bar
```

#### Panel → Chart (sub-namespace)

```
--ui-chart-inset-top     0.2rem   Top inset within chart display area
--ui-chart-inset-bottom  0rem     Bottom inset within chart display area
--ui-chart-axis-gap      0.4rem   Gap between axis label column and chart area
--ui-chart-hud-inset     0.25rem  Inset for floating HUD / tooltip boxes
--ui-chart-x-axis-row-h  0.8rem  Height of the x-axis label row
```

#### Panel → Module Spacing

```
--ui-peak-channel-gap       0.4rem   Gap between peak meter channels
--ui-meter-chart-inset-x    0.6rem   Horizontal inset inside meter chart area
--ui-meter-label-top-inset  0.5rem   Top inset for meter channel labels
--ui-vector-outer-inset     0rem     Outer inset around vectorscope plot
--ui-vector-corner-inset    0.4rem   Corner label inset in vectorscope
```

#### Panel → Minimum Heights

```
--ui-min-h-peak           12rem    Peak panel minimum height
--ui-min-h-history        10rem    Loudness history panel minimum height
--ui-min-h-spectrum       10rem    Spectrum panel minimum height
--ui-min-h-history-chart  8rem     Loudness history chart area minimum height
```

#### Panel → Axis Widths

```
--ui-w-axis-rail   20px   Width of the Y-axis label column
```

### Metric Row

```
--ui-metric-row-pad-x    0.25rem   Horizontal padding inside each metric row
--ui-metric-row-gap      0.5rem    Gap between sibling metric rows
--ui-metric-row-min-h    1.2rem    Minimum row height
--ui-metric-list-gap     0.1rem    Gap managed by the scroll container
--ui-metric-inline-gap   0.4rem    Gap between inline label + value pairs
```

### Drawer (Settings Sheet)

```
--ui-drawer-pad          0.875rem  Inner padding of the settings drawer
--ui-drawer-gap          0.75rem   Gap between settings sections
--ui-drawer-row-gap      0.25rem   Gap between rows within a section
--ui-drawer-row-min-h    1.5rem    Minimum row height
```

## Dock Tokens

Dock is a separate high-density instrument surface with a supported height of `56–160px` and a
default height of `72px`. It shares the global font families, semantic colors, and instrument
colors, but it does not reuse normal-panel typography or spacing dimensions. Normal panels have
minimum heights measured in `rem`; applying those dimensions to Dock would either overflow or
waste its limited data area.

Dock typography is self-contained and does not inherit user-configurable text-size preferences.
Its font sizes respond only to the Dock height tiers below.

Responsive Dock component tokens are owned by `src/dock/dockTokens.css` and scoped to
`.dock-strip`. Height media queries update them directly while the native Dock window is being
resized, without waiting for React state or persisted geometry.

### Responsive density tiers

| Role / token           | Compact `56–63px` | Standard `64–119px` | Expanded `120–160px` |
| ---------------------- | ----------------: | -----------------: | ------------------: |
| `--ui-dock-fs-label`   |               8px |                9px |                10px |
| `--ui-dock-fs-caption` |               8px |                9px |                10px |
| `--ui-dock-fs-value`   |              11px |               13px |                15px |
| `--ui-dock-pad-x`      |               5px |                6px |                 8px |
| `--ui-dock-pad-y`      |               3px |                4px |                 6px |
| `--ui-dock-gap-region` |               4px |                5px |                 7px |
| `--ui-dock-gap-column` |               3px |                4px |                 5px |
| `--ui-dock-gap-row`    |               2px |                3px |                 5px |
| `--ui-dock-bar-min-h`  |               4px |                5px |                 6px |
| `--ui-dock-readout-w`  |               5ch |                5ch |                 5ch |

The tiers are intentionally discrete. Typography must remain stable while the user adjusts height;
the additional space at larger heights primarily benefits bars, plots, and row separation rather
than continuously magnifying every label.

Dock Stats keeps `2px` between each label and its fixed-width value and reserves at least `12px`
between metric groups. Each metric cell compresses from a comfortable `72px` to `60px`, with the
label absorbing that reduction before the responsive grid drops a column from view.

### Typography roles

Within one density tier, the same typography role has the same size in every Dock module. Modules
must use these shared tokens rather than hard-coded font sizes or module-specific emphasis sizes.

- `Label`: detector names, channel names, and compact metric names (`PK`, `RMS`, `M`, `ST`, `L`,
  `R`, `LFE`). Static labels use `--ui-font-sans`, medium weight, and muted foreground.
- `Caption`: compact source-rail annotations such as `PB Max` and `TP Max`. Captions use
  `--ui-font-sans`, medium weight, muted foreground, and the repository Title Case convention. The
  full source name remains available through settings, `title`, and accessible text.
- `Value`: all dynamic numeric displays, including per-channel values, global values such as TP Max
  and correlation, and transport timecode. Values use `--ui-font-mono`, `tabular-nums`, and semibold
  weight. Modules express emphasis through color, weight, position, or interaction rather than a
  larger font size.

Do not append detector names or readout sources after a number. A trailing `M Max` or `RMS Max`
looks like a unit or a different metric. Detector identity belongs on the leading side of the
instrument; a non-live source belongs in a caption aligned with the readout column. Live is the
normal state and needs no caption.

### Responsive rules

- Height selects the density tier. Width does not scale font sizes.
- Additional width belongs to bars, plots, waveforms, and spectra; gaps do not grow with container
  width. Do not use `vw`, `cqw`, or percentage-based spacing for Dock layout gaps.
- Multi-row metric grids may reserve the configured `ch` capacity in their visible mono value
  column when label stability is more important than intrinsic width. A single source rail such as
  `TP Max` or `PB Max` instead keeps its visible source-and-value group intrinsic and trailing
  aligned; an invisible sizing layer reserves the complete region without adding visible whitespace.
- Labels use intrinsic (`max-content`) columns rather than reserving a fixed `ch` width for every
  abbreviation. A module-level Labels setting may remove optional labels to free more data width.
- `--ui-dock-bar-min-h` is a floor, not a fixed bar height. Channel rows divide all available Dock
  height with `minmax(var(--ui-dock-bar-min-h), 1fr)`, and each bar stretches to fill its row.
- Component-specific structural changes, such as multi-bank layout for high channel counts, may use
  container queries. They must not redefine the shared type or spacing scale.

### Reference module grammar

Level Meter is the reference implementation for label/bar/readout modules. Its detector label is
centered against the meter region only. The meter and readout regions are sibling grids that share
the same channel-row count but do not share caption layout:

```text
detector | meter region (channel | minmax(0, 1fr) bar) | readout region
```

Examples:

```text
PK   L   ━━━━━━━━━━━━━   -3.1
     R   ━━━━━━━━━━━━    -4.0

RMS  L   ━━━━━━━━━━━━━   PB Max   -12.2
     R   ━━━━━━━━━━━━             -10.8
```

A non-live readout adds one single-line source rail between the meter and value regions. Use
`TP Max` for true-peak maximum and `PB Max` for playback maximum; do not wrap either label. The rail
is vertically centered across the complete channel grid and does not participate in its row sizing.
Values retain the same channel-row alignment in Live and non-live states. Toggling a source rail
must not change the detector label, channel labels, bar rows, or their available height. Scalar
modes omit the channel column but keep the same detector → data region → source rail → readout
ordering.

Other Dock modules map their content onto the same roles:

- Loudness and Stats: metric name → Label; numeric metric → Value.
- Correlation: primary coefficient → Value.
- Spectrum and Spectrogram: compact scale annotations → Caption.
- Transport: timecode → Value.
- Waveform: necessary lane or channel annotations → Label.

Dock Stats lays selected metrics out from left to right, then top to bottom, using at most three
rows. Its column count follows the available panel width. Metrics that exceed the current capacity
are hidden from the end of the user-defined order, so ordering also defines narrow-width visibility
priority. Stats values do not repeat units in the Dock matrix.

Dock Loudness is the compact form of the normal Loudness panel, not a separate metric selector. Its
history region fills the available height and retains the normal panel's Momentary, Short-term,
and Reference layers. Reference uses the same over-reference trace gradients; Dock does not add a
separate reference line. A content-sized readout rail follows the history region and shows M, ST, and
I as three aligned Label → Value rows. Its settings reuse the normal panel's Ref, Layers, and
Y range controls and vocabulary.

---

## Dataviz Style Tokens

Stroke widths, fill opacities, and grid tuning for chart instruments.

### Loudness

```
--ui-loudness-momentary-stroke-width   1.1    Momentary trace stroke width
--ui-loudness-shortterm-stroke-width   2.1    Short-term trace stroke width
--ui-loudness-selection-stroke-width   1.2    Selection overlay stroke width
```

### Vectorscope

```
--ui-vectorscope-stroke-width    1          Trace stroke width
--ui-vectorscope-axis-opacity    0.8        Axis line opacity
--ui-vectorscope-grid-dash       "2.6 3.4"  Diagonal grid dash pattern
```

### Spectrum

```
--ui-spectrum-stroke-width           1.5    Trace stroke width
--ui-spectrum-fill-top-opacity       0.22   Fill gradient top opacity
--ui-spectrum-fill-bottom-opacity    0.03   Fill gradient bottom opacity
--ui-spectrum-grid-opacity           0.08   Grid line opacity
```

### Waveform

```
--ui-waveform-fill-opacity   0.22   Envelope fill opacity
```

---

## Radius Tokens

```
--radius   0.625rem   Base card-level radius (shadcn native). Use directly.
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
