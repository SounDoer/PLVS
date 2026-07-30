# Spectrogram 3D Surface Mode — Design

**Date:** 2026-07-30
**Status:** Designed, not implemented
**Scope:** Frontend only. `src-tauri` is not touched.

Builds on [2026-07-28-spectrogram-3d-view-design.md](2026-07-28-spectrogram-3d-view-design.md),
which shipped the 3D line waterfall. Read that first: this design reuses its projection, its data
sampling, and every one of its panel controls. Only the drawing is new.

## Summary

A third view mode on the Spectrogram panel: a shaded solid **surface** (relief), rendered per pixel
with exact hidden-surface removal, alongside the existing 2D heatmap and 3D line waterfall.

The entry point changes from a boolean 3D toggle to a three-way **Mode** dropdown.

Monochrome relief is the base look; the existing **Colorize** toggle adds the colormap on top.

## Motivation

The line waterfall shows envelope shape, but it is transparent — every ridge is visible through
every other one, so a dense window reads as a thicket rather than a landscape. A solid shaded
surface is the presentation that makes spectral terrain legible: peaks occlude what is behind them,
and slope shading carries structure that neither height nor colour alone conveys.

## Non-Goals

- **No WebGL.** Same reasoning as the line waterfall: the project contains none, introducing it is
  an ADR-level decision, and nothing here needs it. The per-pixel renderer chosen below is what
  makes that true — the naive alternative (one filled quad per grid cell) is what would have forced
  the question.
- **No hover readout.** Unchanged from the line waterfall, and if anything more firmly out of
  scope: under an opaque surface the value under the cursor may be genuinely hidden.
- **No new user-facing controls.** Surface adds a mode, not a control panel.
- **No dock module support.** Unchanged.
- **No DSP, IPC, or Rust changes.**
- **No size gating.** A narrow panel may select Surface and it will look poor. Lines exists for
  that case; refusing the selection would be a worse answer than letting the user see why.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Surface is a **third view mode**, not a replacement for Lines | At low elevation on a wide, short panel a solid surface genuinely occludes its own interior — that is correct rendering, not a bug, and it makes Lines the better mode there. Both are kept for that reason |
| 2 | Entry becomes a **three-way `Mode` dropdown** | A boolean cannot express three states, and `vectorscopeMode` / `stereoMapMode` / `levelMeterMode` already establish the string-enum pattern |
| 3 | `spectrogram3d` boolean is **deleted, not migrated** | It has never shipped — the whole 3D feature is unmerged. A migration would carry a legacy key for no live data |
| 4 | **Per-pixel column rasterisation** (heightfield / floating-horizon), not filled geometry | See Rendering. Exact occlusion for free, deterministic cost, no path or gradient overdraw |
| 5 | Data sampling is **reused unchanged** | `sampleWaterfallGrid` already solved three classes of flicker via absolute-time bucketing. A second time-resampling scheme would reintroduce all three |
| 6 | Shading is a **viewer-side headlight** derived from the along-ray height delta | Free (it is already being computed), and stable under rotation — a world-fixed light would darken whole faces as the scene turns |
| 7 | Monochrome ramps between the **colormap's two ends**; Colorize ramps by **absolute dB** | Makes the toggle read as one continuous knob rather than two unrelated looks, and keeps the ramp theme-bound |
| 8 | Colorize modulates **luminance only, at reduced depth** | Preserves the shipped design's Decision #8: colour stays a function of absolute level, so the dB Floor never recolours a peak |
| 9 | Surface is composited via an **offscreen canvas + `drawImage`** | `putImageData` overwrites rather than blends; writing straight to the main canvas would erase the floor grid beneath it |
| 10 | Scrub is marked **inside the rasteriser**, not stroked on top | Occlusion-correct and nearly free. A selected moment hidden behind a peak is legitimately invisible |
| 11 | Lines and Surface **share every view control key** | Switching between them preserves viewpoint, height scale, colour and grid — the same scene, drawn two ways |
| 12 | Performance is **measured before the module interface is fixed** | Whether column decimation is needed changes the rasteriser's signature. See Performance |

## The geometric fact the algorithm rests on

The projection is orthographic and affine, so for a fixed screen column `x`:

```
t·tx + f·fx = x − originX
```

is a straight line on the floor plane. Its direction is `(dt, df) ∝ (−fx, tx)`, and the screen-y
increment along that direction is

```
dy = (−fx)·ty + tx·fy = tx·fy − ty·fx = det
```

`det` is exactly the determinant `unprojectFloor` already relies on — `depth · scaleX · scaleY` —
which is **strictly positive for every elevation `clampViewParams` allows**.

So walking along `(−fx, tx)` always advances from far to near, at every azimuth and elevation, with
no sign casework. The `ridgeOrderAscending` style of painter's-order reasoning has no analogue in
this renderer: draw order is a property of the walk direction, and the walk direction is a constant.

## Rendering

### The column walk

```
for each screen column x:
  clip the floor line against the unit square [0,1]², take the entry point as the far end
  horizon = +Infinity                    // topmost (smallest y) pixel already written in this column
  step along the line — t and f advance by constant addition:
    h = normalised dB × heightGain       // the same height map Lines uses
    y = originY + t·ty + f·fy + h·hy
    if y < horizon:
      fill the span y .. horizon with this sample's colour
      horizon = y
```

Three properties follow directly:

- **Hidden-surface removal is exact and free.** It is the `horizon` running minimum. Occluded
  pixels are never written, so there is no overdraw, no painter's algorithm, and none of the
  self-occlusion pathology that killed the filled-ridge attempt (Reversed #1 in the shipped design)
  — that failure came from filling each ridge down to a baseline, which is a curtain, not a surface.
- **The `y .. horizon` span is the vertical wall** between this sample and the previous silhouette.
  Filling it is what makes the result read as solid rather than as a stack of contours.
- **Slope is free.** `h − h_prev` is the height gradient along the view ray, which is the shading
  term. Because the ray always points at the viewer, this is a headlight: shading stays stable while
  the user rotates. It is flat on its own, so a mild depth attenuation (from the already-computed
  `t·ty + f·fy`) supplies the remaining sense of recession.

Unpainted pixels keep `alpha = 0`, so the panel background — including the glass effect — shows
through. Surface must not draw its own opaque backdrop.

### Data

The walk needs random access to `dB(t, f)`. That is precisely the grid `sampleWaterfallGrid`
already produces: rows are frames chosen by absolute-time bucketing, columns are `pointCount`
frequency points mapped through the cached `yToBand`.

**`spectrogram3dGrid.js` and `spectrogram3dProjection.js` are not modified.** The three flicker
fixes recorded in the shipped design — absolute-time buckets, stride quantised to whole frame
periods, bucket state seeded from the frame just outside the window — are inherited rather than
re-derived. Any per-column time resampling invented here would bring all three back, and this time
there would be no individual ridges to debug them against.

Row count may be far higher than in Lines (hundreds), because cost no longer scales with it: cost
is columns × steps.

### Colour

- **Colorize off** — ramp position is the shading value; endpoints are the lowest and highest
  entries of `colormapLut`. Luminance only, no hue.
- **Colorize on** — ramp position is absolute dB via the shared `spectrogramColorFrac(db, dbFloor)`;
  shading applies as a small luminance multiplier (roughly 0.75–1.0).

The two states are the same palette desaturated and saturated, so toggling does not read as
switching to a different chart.

### Compositing

`putImageData` overwrites the destination, alpha included, so an `alpha = 0` surface pixel would
erase whatever was drawn beneath it. Order per repaint:

1. Rasterise the surface into a reused offscreen canvas's `ImageData`.
2. Draw the floor grid on the main canvas.
3. `drawImage(offscreen)` — this blends.
4. Draw the axis labels.

The offscreen canvas and its `ImageData` are rebuilt on resize, never per frame.

### Canvas units

Unchanged from the shipped design and equally binding: the canvas is sized in device pixels, and the
ratio is derived from the canvas's own dimensions rather than `window.devicePixelRatio`. Per the
Windows text-scaling pitfall in `AGENTS.md`, labels following the Accessibility text-size factor is
correct behaviour and must not be "fixed".

## Architecture

### New: `src/math/spectrogram3dSurface.js`

Pure. No canvas, no React, no data access.

- Floor-line clipping against the unit square for a given column and projection, returning the
  entry point and the constant `(dt, df)` step.
- The horizon rasteriser, writing into a caller-supplied buffer.

Everything testable lives here, following the split the shipped design established: the two math
modules carry the tests, the hook carries none.

### Modified

| File | Change |
|---|---|
| `src/hooks/useSpectrogram3dCanvas.js` | Mode branch: lines path unchanged, surface path added, offscreen canvas lifecycle |
| `src/lib/panelControls.js` | `spectrogramMode` enum plus normalizer; `spectrogram3d` removed |
| `src/components/PanelSettingsContent.jsx` | Mode dropdown; Line Alpha / Line Width shown only in Lines |
| `src/components/panels/SpectrogramPanel.jsx` | `is3d` derived from the mode; mode threaded to the renderer |
| `src/components/panels/chartHelp.js` | Predicate becomes `mode !== "heatmap"` |

If the hook grows past a comfortable size (it is 525 lines today), the surface path splits into
`useSpectrogram3dSurface.js`. That is a judgement made while implementing, not a commitment here.

## Panel Controls

| Key | Default | Range | Applies to |
|---|---|---|---|
| `spectrogramMode` | `"heatmap"` | `"heatmap"` \| `"lines"` \| `"surface"` | — |
| `spectrogram3dColorize` | `true` | boolean | Lines, Surface |
| `spectrogram3dHeightGain` | `1` | 0.3 – 3 (**Height Scale**) | Lines, Surface |
| `spectrogram3dAzimuthDeg` | `135` | 0 – 360, wraps | Lines, Surface |
| `spectrogram3dElevationDeg` | `60` | 5 – 85 | Lines, Surface |
| `spectrogram3dFloor` | `true` | boolean (**Grid**) | Lines, Surface |
| `spectrogram3dLineAlpha` | `1` | 0.15 – 1 | **Lines only** |
| `spectrogram3dLineWidth` | `1` | 0.5 – 3 | **Lines only** |
| `spectrogramDbFloor` | `SPECTROGRAM_DB_MIN` | −96 – −12 | all three modes |
| `spectrumOctaveSmoothing` | existing | existing | all three modes |

`spectrogramMode` is the only new key, and `spectrogram3d` is deleted outright. It has never
shipped, so nothing persisted anywhere contains it; `cleanupLegacyKeys.js` is not touched. The one
cost is that a dev machine's local state falls back to `heatmap` once.

Dropdown labels are `2D Heatmap` / `3D Lines` / `3D Surface` — Title Case, per `AGENTS.md`. The
2D/3D prefix is carried in the label because that is the distinction users are actually choosing
between.

**No new control is added for Surface.** Shading strength, depth attenuation and column stride are
performance parameters wearing an aesthetic costume — the same reason the shipped design withdrew
ridge and point counts after exposing them during tuning.

All of these ride the existing `panelControls` persistence path. No new persisted domain key.

## Interaction

Identical to Lines, with no exceptions: right-drag rotates, left-drag pans the timeline, wheel
zooms it, Ctrl+wheel / Ctrl+drag work the frequency range through `unprojectFloor`, double-click
returns to latest, the left axis rail drives Height Scale, and the bottom rail drives the time
window. Hover readout, channel marker lines and data-boundary lines stay suppressed;
`TimelineLatestEdgeHint` stays.

Because gestures are shared, `chartHelp.js` keeps two help sets rather than three.

### Scrub

There is no ridge to highlight. Instead the rasteriser substitutes a highlight colour when a sample
lands on the selected frame's row. This is occlusion-correct: if the selected moment is behind a
peak, it is not drawn, which is the truthful answer for an opaque surface.

## Performance

Lines measured 1.2 ms at 922×110 and 3.4 ms at 2560×900. Surface has an entirely different cost
model — columns × steps, plus written pixels:

| Canvas | Columns × steps | Inner iterations | Pixel writes (bound) |
|---|---|---|---|
| 922×110 | 922 × ~250 | ~230 k | ≤ 100 k |
| 2560×900 | 2560 × ~400 | ~1 M | ≤ 2.3 M |

The small panel is comfortable. **The large panel is not predictable from here** — plausibly
10–25 ms, i.e. possibly over the 16.7 ms interactive budget. Available levers, in the order they
should be reached for:

1. **Column stride** — rasterise every second column and replicate horizontally. Halves cost
   directly, and it changes the module's signature, which is why it must be settled early.
2. **Step length derived from screen pixels** rather than grid cells, so steps do not multiply with
   row count.
3. The existing repaint-skip guard, which already holds repaints near 25 Hz rather than 60.

**Therefore: measure the inner loop in the same browser harness used for Lines before writing the
production module.** Whether stride 1 or 2 is the default is a measured decision, not a guess.

As with the Lines measurements, the harness is a replica: Chromium is not WebView2, and there is no
competing load from capture, DSP or other panels. It narrows the question; it does not close it.

### Repaint guard

`spectrogramMode` must join the repaint-skip comparison set. Every input that can change the
picture has to be in it — a missing one produces a control that silently does nothing, which looks
exactly like a frozen render.

## Testing

New tests in `src/math/spectrogram3dSurface.test.js`:

- Floor-line clipping returns entry and exit points on the unit square, swept across azimuth and
  elevation.
- The walk direction advances monotonically toward the viewer at every allowed view — the `det > 0`
  property, asserted rather than assumed.
- Occlusion invariants on synthetic heightfields: a tall near ridge hides a short far one; a tall
  far ridge pokes above a short near one; a flat field produces one unbroken silhouette.
- Every pixel inside the floor footprint is written; every pixel outside it keeps `alpha = 0`.
- The selected row's highlight appears only where that row is unoccluded.

Updated tests: `panelControls` normalizer for the new enum (including rejection of unknown strings),
`chartHelp` for the three-way predicate, and the `SpectrogramPanel` suites that currently set
`spectrogram3d: true`.

### Not covered

- The renderer hook, by design — consistent with `useSpectrogramCanvas.js` and the Lines path.
- Appearance, in all cases. Shading depth, depth attenuation and the monochrome ramp endpoints are
  tuned by eye and pinned by nothing.
- Real-app performance. The harness is the only planned measurement.

## Acceptance

1. All three modes selectable from the dropdown; 2D and Lines behave exactly as before.
2. Surface renders as a solid shaded relief with peaks occluding what is behind them.
3. Colorize off/on reads as one continuous palette, and Colorize on leaves colour a function of
   absolute dB — raising the dB Floor does not recolour a peak.
4. The floor grid remains visible around and beneath the surface silhouette; the panel background
   shows through where the surface does not cover.
5. Switching Lines ↔ Surface preserves viewpoint, height scale, time window and frequency range.
6. Scrubbing highlights the selected moment where it is visible.
7. Mode and all view parameters survive preset save/load.
8. Real capture gaps render as holes in the surface.
9. The harness measurement is recorded, and the chosen column stride is justified by it.
10. `npm run check` passes.
