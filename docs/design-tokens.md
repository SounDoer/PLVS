# Design Token Specification

PLVS UI token system — established from design review, May 2026.  
Implement via `src/preferences/data.js` + `src/preferences/applyDocumentTheme.js`.  
Color themes are V2 authoring documents compiled through `src/theme/compileTheme.js`.

---

## Architecture

Three layers. Components consume **Semantic** (shadcn) or **Component** tokens only — never raw palette values.

```
Authoring    Six Core Colors, three purpose-specific Palettes, and sparse Advanced overrides.
             Builtins live in builtinThemesV2.js; custom documents use the same schema.

Resolved     themeRoleRegistry.js defines every meaningful visible role and its dependencies.
             compileTheme.js produces one complete immutable CSS / Canvas / effect contract.

Component    PLVS-specific --ui-* tokens with no shadcn equivalent.
             Theme colors are written by themeRuntime; layout tokens by applyLayoutToDocument().
             Responsive Dock tokens are scoped by src/dock/dockTokens.css because they depend
             on the Dock window viewport height. Sub-namespaces include typography, spacing,
             radius, dataviz, and dock.
```

---

## Focus

PLVS draws no focus outline. One rule in the `base` layer of `index.css` clears the
browser's own — Chromium paints `outline: auto` in a fixed high-contrast color on any
focusable element that defines no focus style, and reveals it after any keydown,
including a bare modifier. Components must not reintroduce a `focus-visible:ring-*` or
`focus-visible:outline-*` of their own; a contract test in
`src/components/ui/themeColorContract.test.js` fails if one appears.

`--ring` still exists and is still compiled, because menu and list keyboard highlighting
is a background change (`focus:bg-accent`) rather than an outline and is unaffected.

## Scaling with Interface Size

Interface Size rewrites the whole `--ui-fs-*` scale (`control` goes 13 → 15 → 17), so anything sized
in `px` or `rem` stays put while the text inside it grows. A box that fits at Default clips at
Extra Large, and nothing warns you.

The rule: **if a box's job is to hold text, size it in units that scale with that text.**

| Situation                       | Use                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| Column holding a known label    | `w-[calc(<label>em + <padding>rem)]` — the em share covers the text and any icon, the rem share the padding and gaps |
| Numeric field                   | `w-[7ch]` — `ch` follows the font                           |
| Column holding a short unit     | `w-[3.2em]`                                                 |
| Chart axis rail                 | `max(<px floor>, calc(var(--ui-fs-axis) * <ratio>))`, as `--ui-chart-y-axis-rail-w` already does |
| Floating editor panel           | `--ui-editor-w`, which the Interface Size profiles set alongside `--ui-drawer-w` |

Heights are the looser half of this: a control at `h-6` still holds 17px text, since flex centring
plus visible overflow degrades quietly rather than clipping. Widths do not — they clip.

## Grid Lines

Every module's grid resolves from one role, and the panel paints it at full strength. There is no
second multiplier anywhere: a grid that should read lighter takes the lighter role, not an alpha.

| Role              | Dark      | Used by                                                        |
| ----------------- | --------- | -------------------------------------------------------------- |
| `data.grid`       | `#282828` | Vectorscope diagonals, 3D floor frame |
| `data.gridSubtle` | `#1e1e1e` | Subdivisions inside a grid — today only the 3D spectrogram floor |

Dimming in the draw call is what this replaces. Five panels each carried their own constant — `0.3`
and `0.16` hardcoded in the 3D floor, `0.08` for the stereo map baseline read from the *spectrum's*
opacity token, and a spectrum grid drawn straight from `--border` at `0.08` for an effective alpha
around `0.007`. None of it was visible to the theme, so none of it moved when a theme did.

A contract test in `src/components/ui/themeColorContract.test.js` rejects the two shapes that
brought it back: a reference to `--ui-spectrum-grid-opacity`, and a grid stroked from `--border`.

Only the Vectorscope and the 3D Spectrogram draw a grid. Spectrum, Stereo Map, Waveform and
Loudness draw none; their roles stay in the registry against a future toggle, so each resolves a
colour that nothing paints.

A grid line is 1px. Below that a stroke lands on a fraction of a device pixel and the renderer
pays for it in alpha, which reads as a colour problem and is not one — the vectorscope's diagonals
spent a long time at `0.35`.

## Modal Scrim

`SCRIM_CLASS` in `src/components/ui/surfaceStyles.js` is the only dim in the app: black at 60%,
carried by every modal — the settings drawer, the close confirmation, the update dialog, and the
two editors' discard confirmations. Callers add their own stacking order and, in the drawer's case,
the blur.

The scrim is deliberately not a theme colour. Darkening is a direction, not a hue, and a value
derived from the theme reverses it: the retired `effect.scrim` role tinted the workspace, which on
a light theme produced a near-white veil that washed the background out instead of dimming it. If
this ever needs to follow the theme, the opacity is what varies.

## Highlight States

Two states, never mixed.

| State   | Means                                   | Treatment                                                                                            |
| ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Neutral | The pointer or focus is here, right now | `hover:bg-muted/50`, plus `focus-within:bg-muted/50` on list rows                                    |
| Accent  | This item is the active or selected one | `bg-accent text-accent-foreground` for regions; solid `bg-primary` for small marks and switch tracks |

`--accent` (`interface.surface.interactive`) is accent-tinted, so spending it on hover reads as
"this is selected" every time the pointer crosses a row. It belongs only to persistent state —
an open menu's trigger, an engaged toggle. Dropdown items say "selected" with a check mark and
use the neutral highlight for traversal, mouse and keyboard alike.

`hover:bg-secondary/*` survives only on controls already filled with `--secondary` (the `secondary`
button and badge variants), where hover shifts the control's own fill rather than tinting a
transparent one. Contract tests in `src/components/ui/themeColorContract.test.js` hold both rules.

## Color Tokens

### Shadcn Semantic

Current PLVS Dark values:

| Token                      | Value                       | Role                                  |
| -------------------------- | --------------------------- | ------------------------------------- |
| `--background`             | `#070707`                   | Workspace background                  |
| `--foreground`             | `#f2f2f2`                   | Primary text                          |
| `--card`                   | `#151515`                   | Panel surface                         |
| `--card-foreground`        | same as `--foreground`      | Text on panels                        |
| `--popover`                | same as `--card`            | Popover background                    |
| `--popover-foreground`     | same as `--foreground`      | Popover text                          |
| `--primary`                | `#fb923c`                   | Interface accent                      |
| `--primary-foreground`     | `#070707`                   | Text on primary buttons               |
| `--secondary`              | `#232323`                   | Secondary surface                     |
| `--secondary-foreground`   | same as `--foreground`      | Text on secondary surface             |
| `--muted`                  | same as `--secondary`       | Muted surface                         |
| `--muted-foreground`       | `#898989`                   | Secondary / muted text                |
| `--accent`                 | same as `--secondary`       | Accent surface                        |
| `--accent-foreground`      | same as `--foreground`      | Text on accent surface                |
| `--border`                 | `rgba(255, 255, 255, 0.09)` | Borders and dividers                  |
| `--input`                  | `rgba(255, 255, 255, 0.14)` | Input field border                    |
| `--ring`                   | `#fb923c`                   | Focus ring — follows interface accent |
| `--destructive`            | `#f94144`                   | Error / danger state                  |
| `--destructive-foreground` | `#fafafa`                   | Text on destructive                   |
| `--radius`                 | `0.625rem`                  | Base border radius (card level)       |

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

Instrument traces are compiled from the V2 Primary Data, Secondary Data, Status, and Frequency
authoring roles. Components consume only the resolved `--ui-*` tokens below (or the equivalent
Resolved Theme Canvas bundle); they never derive colors locally.

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

| Token                             | Value            | Role                                    |
| --------------------------------- | ---------------- | --------------------------------------- |
| `--ui-loudness-momentary`         | `#fb923c`        | Loudness M live primary data trace      |
| `--ui-loudness-momentary-snap`    | `#fbd34d`        | Loudness M snapshot trace               |
| `--ui-loudness-shortterm`         | `#c66a2a`        | Loudness ST live sibling data trace     |
| `--ui-loudness-shortterm-snap`    | `#cea536`        | Loudness ST snapshot sibling trace      |
| `--ui-loudness-selection`         | `#fbd34d`        | Selected-offset baseline                |
| `--ui-loudness-grid`              | `#282828`        | Loudness grid lines                     |
| `--ui-vectorscope-trace`          | `#fb923c`        | Vectorscope path (live)                 |
| `--ui-vectorscope-trace-snap`     | `#fbd34d`        | Vectorscope path (snap)                 |
| `--ui-vectorscope-grid-stroke`    | `#282828`        | Vectorscope axis and grid strokes       |
| `--ui-spectrum-primary`           | `#fb923c`        | Spectrum primary path + fill            |
| `--ui-spectrum-primary-snap`      | `#fbd34d`        | Spectrum primary snapshot path + fill   |
| `--ui-spectrum-secondary`         | `#38bdf8`        | Spectrum secondary path + fill          |
| `--ui-spectrum-secondary-snap`    | `#b1d2ff`        | Spectrum secondary snapshot path + fill |
| `--ui-waveform-trace`             | `#fb923c`        | Waveform envelope stroke + fill         |
| `--ui-waveform-trace-snap`        | derived          | Waveform snapshot trace                 |
| `--ui-waveform-frequency-low`     | `#ff2d3d` (dark) | Low-frequency Waveform hue anchor       |
| `--ui-waveform-frequency-mid`     | `#fb923c` (dark) | Mid-frequency Waveform hue anchor       |
| `--ui-waveform-frequency-high`    | `#356dff` (dark) | High-frequency Waveform hue anchor      |
| `--ui-waveform-frequency-neutral` | `#484850` (dark) | Broadband / unavailable spectral color  |
| `--ui-waveform-centroid`          | scheme-aware     | Spectral centroid overlay trace         |

### Component: Signal (semantic state colors)

Values that carry a pass/warn/fail meaning — not brand-derived.

| Token              | Value     | Role                         |
| ------------------ | --------- | ---------------------------- |
| `--ui-signal-bad`  | `#f97373` | General error / clip state   |
| `--ui-signal-warn` | `#fbbf24` | General warning state        |
| `--ui-signal-good` | `#34d399` | General safe / healthy state |

### Component: Spectrogram Colormap

The spectrogram uses a per-theme ordered stop list, not a CSS variable.
The V2 Intensity Palette owns the ordered stops, and
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

| Role                  | Token                  | Size | Typical use                                                 |
| --------------------- | ---------------------- | ---- | ----------------------------------------------------------- |
| **Caption**           | `--ui-fs-caption`      | 10px | Menu groups, compact metadata, drag/drop overlay labels     |
| **Axis Annotation**   | `--ui-fs-axis`         | 11px | Chart ticks, secondary hints, validation and tooltip text   |
| **Status**            | `--ui-fs-status`       | 11px | Header/footer state and compact status chips                |
| **Control**           | `--ui-fs-control`      | 12px | Compact buttons, selects, inputs and management rows        |
| **Metric Annotation** | `--ui-fs-metric-meta`  | 12px | Metric names and units                                      |
| **Panel Title**       | `--ui-fs-panel-title`  | 12px | Panel, editor and dialog titles                             |
| **Dynamic Display**   | `--ui-fs-display`      | 13px | Live chart values and settings drawer text                  |
| **Body**              | `--ui-fs-body`         | 14px | General descriptions, empty states and standard UI controls |
| **Metric Value**      | `--ui-fs-metric-value` | 16px | Primary metric values; mono with tabular numerals           |

Relative `em` sizes are allowed inside a semantic parent when they express a local hierarchy.

## Icon Tokens

Normal application surfaces create icon tokens only for roles with an independent scaling policy.
Do not introduce a generic icon size scale.

| Role                  | Token                         | Default | Usage                                                   |
| --------------------- | ----------------------------- | ------: | ------------------------------------------------------- |
| Panel Action          | `--ui-icon-panel-action`      |    12px | Panel settings, help, pin, fullscreen and close actions |
| Management Action     | `--ui-icon-management-action` |    14px | Rename, delete, save, cancel and reset actions          |
| Shell Action          | `--ui-icon-shell-action`      |    14px | Icon-only actions in the normal application header      |
| Panel Module Identity | `--ui-icon-panel-module`      |    14px | Module identity next to a normal panel title            |

Icons paired with text use local `em` sizing instead of global tokens: inline indicators use `1em`,
button-leading icons use `1.15em`, and module-list icons use `1.25em`. Module definitions own only
the Lucide glyph; each rendering context owns its presentation size.

Status dots, switch thumbs, drag handles, resize rails, control containers and data visualizations
are component geometry, not iconography tokens. Dock is excluded and keeps its self-contained
responsive contract in `src/dock/dockTokens.css`.

### Interface size profiles

The global `settingsStore.interfaceSize` setting selects one of four hand-tuned profiles. Profiles
write final integer pixel values rather than applying browser zoom or one uniform multiplier.

| Role                       | Small | Default | Large | Extra Large |
| -------------------------- | ----: | ------: | ----: | ----------: |
| Caption                    |  10px |    11px |  12px |        14px |
| Axis / Status              |  11px |    12px |  14px |        16px |
| Control / Panel Title      |  12px |    13px |  15px |        17px |
| Dynamic Display            |  13px |    14px |  16px |        18px |
| Body                       |  14px |    15px |  17px |        19px |
| Metric Value               |  16px |    18px |  21px |        24px |
| Panel Action Icon          |  12px |    13px |  15px |        17px |
| Management / Shell Icon    |  14px |    15px |  17px |        19px |
| Panel Module Identity Icon |  14px |    15px |  17px |        19px |
| Settings Drawer Width      | 320px |   336px | 368px |       400px |

The normal application document applies the selected profile before first render. Dock header and
editor accessory documents always apply the compact Small baseline, while the Dock strip continues to use only its
responsive `--ui-dock-*` typography.

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
--ui-chart-x-axis-row-h      max(0.8rem, axis * 1.15)  Height of the x-axis label row
--ui-chart-y-axis-rail-w     max(20px, axis * 1.65)    Width of the y-axis label rail
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
--ui-drawer-w            20rem     Preferred Small-profile drawer width
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
| ---------------------- | ----------------: | ------------------: | -------------------: |
| `--ui-dock-fs-label`   |               8px |                 9px |                 10px |
| `--ui-dock-fs-caption` |               8px |                 9px |                 10px |
| `--ui-dock-fs-value`   |              11px |                13px |                 15px |
| `--ui-dock-pad-x`      |               5px |                 6px |                  8px |
| `--ui-dock-pad-y`      |               3px |                 4px |                  6px |
| `--ui-dock-gap-region` |               4px |                 5px |                  7px |
| `--ui-dock-gap-column` |               3px |                 4px |                  5px |
| `--ui-dock-gap-row`    |               2px |                 3px |                  5px |
| `--ui-dock-bar-min-h`  |               4px |                 5px |                  6px |
| `--ui-dock-readout-w`  |               5ch |                 5ch |                  5ch |

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
--ui-loudness-momentary-stroke-width   1.2    Momentary trace stroke width
--ui-loudness-shortterm-stroke-width   2      Short-term trace stroke width
--ui-loudness-selection-stroke-width   1.2    Selection overlay stroke width
```

### Vectorscope

```
--ui-vectorscope-stroke-width    1.2        Trace stroke width
--ui-vectorscope-axis-opacity    0.8        Axis line opacity
--ui-vectorscope-grid-dash       "2.6 3.4"  Diagonal grid dash pattern
```

### Spectrum

```
--ui-spectrum-stroke-width           1.5    Trace stroke width; also the 3D spectrogram ridges
--ui-spectrum-fill-top-opacity       0.22   Fill gradient top opacity
--ui-spectrum-fill-bottom-opacity    0.03   Fill gradient bottom opacity
--ui-spectrum-grid-opacity           0.08   Grid line opacity
```

### Waveform

```
--ui-waveform-fill-opacity   0.22   Envelope fill opacity
--ui-waveform-stroke-width   1      Envelope stroke width
```

---

## Radius Tokens

Three rungs, all derived from `--radius` (`0.625rem`), plus the pill.

| Utility        | Value  | Owner                                                              |
| -------------- | ------ | ------------------------------------------------------------------ |
| `rounded-xs`   | `4px`  | Items nested in a `p-1` container; any control under 28px tall       |
| `rounded-md`   | `8px`  | Surfaces — panels, popovers, menus — and controls 28px and taller    |
| `rounded-xl`   | `12px` | Floating windows: the draggable editors and the centred dialogs      |
| `rounded-full` | pill   | Switches, sliders, resize rails, dots                                |

Two rules decide the rung, in this order:

1. **Concentric.** A child sitting on its parent's corner takes `parent − padding`. A menu row in a
   `p-1` popover is `8 − 4 = 4`, which is exactly `xs`. Break this and the two arcs stop being
   concentric, which reads as a seam nobody can name.
2. **Height.** Otherwise pick by the element's own height: a radius wants to be about a fifth of it.
   `8px` on a 24px icon button is a third of its height and reads as a squircle, so small controls
   take `xs` even though they are controls.

Surfaces and standard controls deliberately share one value. Elevation is already carried by the
`background → card → popover → secondary` lightness ladder and by shadow; saying it a third time in
the corner radius is redundant. Radius only needs to answer two questions: am I on someone else's
corner, and am I a window.

`rounded` (bare) is banned: Tailwind compiles it to a literal `0.25rem` that ignores `--radius`, so
it silently opts out of the ladder — and it was the single most used radius in the app before this
was written down. `rounded-sm` and `rounded-lg` stay defined but unused; deleting the definitions
would hand those utilities back to Tailwind's defaults, which is worse than leaving them. Hardcoded
`rounded-[Npx]` is banned for the same reason. `src/components/ui/radiusContract.test.js` enforces
all of it.

A `var(--ui-*)` that nothing defines fails silently — the declaration is dropped and the property
falls back to its initial value, with no console warning and no test failure. `--ui-radius-modal`
sat undefined long enough to square off all three floating panels that asked for it, which is why
`src/preferences/uiTokenContract.test.js` fails on any dangling reference.

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
