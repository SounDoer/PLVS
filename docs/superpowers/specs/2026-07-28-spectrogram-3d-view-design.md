# Spectrogram 3D Waterfall View — Design

**Date:** 2026-07-28
**Status:** Approved, not yet implemented
**Scope:** Frontend only. `src-tauri` is not touched.

## Summary

Add a 3D waterfall (hidden-line mesh) view mode to the existing Spectrogram panel, selected by a
per-panel toggle. The 3D view consumes the same snapshot history as the 2D heatmap and shares its
time window, so switching modes never changes what data is on screen — only how it is drawn.

The mode is positioned as **presentation-first**: it shows how energy evolves, it does not replace
the 2D heatmap for reading values. Hover readout is deliberately absent (see Non-Goals).

## Motivation

The 2D spectrogram encodes magnitude as colour only. Envelope shape over time — attack, decay,
resonant tails, low-end build-up — is legible in a 3D waterfall in a way a heatmap does not convey.
The data needed for it is already in the panel; only the rendering differs.

## Non-Goals

- **No hover readout in 3D.** Inverting a 3D projection back to (time, frequency, dB) under
  occlusion is unreliable. A wrong number is worse than no number. Users switch to 2D to read values.
- **No dock module support.** `DockSpectrogram` renders in a narrow strip where a waterfall would be
  illegible. `src/dock/dockModuleControls.js` is unchanged.
- **No DSP, IPC, or Rust changes.** No new engine request, no new frame field.
- **No WebGL.** Canvas 2D only. Painter's algorithm resolves occlusion without a depth buffer, and
  the project currently contains no WebGL at all — introducing it would be an architecture-level
  decision warranting its own ADR.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | 3D is a **view mode of the Spectrogram panel**, not a new panel | Reuses data source, settings, colormap, time window; smallest increment |
| 2 | Presentation-first; analysis capability deferred | Set by the user at design time; keeps v1 scope closed |
| 3 | **Follows the existing time window**, downsampled | Shares scrub, zoom, and frozen snapshots with 2D; no second timeline to explain |
| 4 | **Orthographic** projection, not perspective | Perspective compresses the far end of the time axis; with a shared time window that misleads. Parallel axes keep time spacing honest. It also makes dB→screen-height a single scene-wide linear map, which is what lets Colorize reuse one gradient (see Performance Model) |
| 5 | **Hidden-line mesh** (style B): opaque background fill + stroke | Occlusion is what makes the surface read as solid. Painter's algorithm gives it for free |
| 6 | Stroke colouring is a **toggle** (`Colorize`) | Off = classic monochrome mesh. On = theme colormap, keeping parity with 2D theming. Both cost effectively the same, so the toggle is an aesthetic choice, not a performance escape hatch |
| 7 | Rotation on **right-drag** only | Left-drag, wheel, Ctrl-combos and double-click keep their 2D meanings. Right-click menu is already suppressed on this canvas |
| 8 | Left axis rail controls **Height Gain** in 3D | The vertical screen direction is the dB axis, and it is the only axis that stays vertical under rotation. Frequency and time swap visual direction as azimuth turns |
| 9 | Scrub feedback is a **highlighted ridge**, not a selection line | A vertical line through a 3D scene has no meaning; ridges are drawn one by one anyway |
| 10 | Floor grid and slanted axis labels ship in v1 | They carry most of the perceived finish of this chart type |

### Rejected alternatives

- **Fixed viewpoint, no rotation.** Cheapest, but occlusion becomes unresolvable — peaks hide peaks
  on dense material, which is the common case.
- **Remapping chart-area gestures to 3D** (left-drag rotates, wheel dollies, time/frequency fall
  back to the rails). Technically clean — both rails already carry full pointer and wheel handlers —
  but it makes wheel and left-drag mean different things per mode. Gesture semantics drifting with
  mode is a durable product debt; WebGL is merely engineering effort. Rejected for that asymmetry.
- **Filled colour ribbons** (style C, the SignalScope look). Colour parity with 2D, but rebuilds a
  multi-stop `CanvasGradient` per ridge per frame and loses the fine mesh texture.

## Architecture

### New: `src/math/spectrogram3dMath.js`

Pure functions. No React, no canvas. Two layers so the renderer can be swapped later without
touching data access.

- `sampleWaterfallGrid(view, startIdx, endIdx, oldestMs, span, sampleMs, ridgeCount, yToBand)`
  → `{ heights: Float32Array(ridgeCount * pointCount), present: Uint8Array(ridgeCount),
  timestamps: Float64Array(ridgeCount) }`

  `pointCount` is `yToBand.length` — the caller sizes the frequency axis by choosing the lookup
  table's length, so the grid has exactly one column per entry.

  Resolves the newest active frame per ridge slot by binary search on timestamps. This is the same
  strategy the 2D long-zoom branch already uses in `useSpectrogramCanvas.js` (the `endIdx - startIdx
  + 1 > W * 4` path), with the column count generalised from canvas width to `ridgeCount`.

  **Real gaps in time must stay empty**, exactly as 2D leaves them unpainted. A ridge slot whose
  target timestamp falls outside any frame's `[timestampMs, frameEndMs)` is marked absent and is not
  drawn. Interpolating across a gap would invent data the capture never produced.

- `buildProjection({ azimuthDeg, elevationDeg, width, height })` → precomputed projection
  coefficients plus the ridge draw order.
- `projectPoint(tFrac, fFrac, hFrac, projection)` → `{ x, y }` in device pixels.
- `clampViewParams({ azimuthDeg, elevationDeg, heightGain })` → clamped values.

### New: `src/hooks/useSpectrogram3dCanvas.js`

Sibling to `useSpectrogramCanvas`, same shape: `requestAnimationFrame` loop, `paramsRef` mirror of
props, cached derived tables. Draws the floor, the ridges back-to-front, then the axes and labels.

The existing repaint-skip cache **does** carry over and must be kept. Spectrum frames arrive at 25 Hz
and the time window advances at 10 Hz, so a live 3D view needs ~25 repaints per second, not 60. Only
active dragging or rotation pushes it to display rate. Skipping this cache would triple the cost for
no visible gain.

### New: `src/math/spectrogram3dMath.test.js`

Follows the repo's existing split — everything under `src/math/` has a test, `useSpectrogramCanvas.js`
has none, because canvas work is not meaningfully testable under jsdom. All testable logic therefore
lives in the math module and the hook keeps only the rAF loop and canvas calls.

### Modified

| File | Change |
|---|---|
| `src/components/panels/SpectrogramPanel.jsx` | Branch on `spectrogram3d`: mount the 3D hook instead of the 2D one; suppress hover and SVG overlays; relabel/reroute the axis rails |
| `src/lib/panelControls.js` | Five new keys + normalization |
| `src/components/PanelSettingsContent.jsx` | `3D View`, `Colorize`, `Height Gain`, `Reset View` |
| `src/components/panels/chartHelp.js` | Help entries for 3D mode |

`src/workspace/clampPanelControls.js` is **not** modified — it clamps channel selection only; numeric
range normalization lives in `normalizePanelControls`.

`src/hooks/useSpectrogramCanvas.js` is **not** modified. The 2D path is untouched.

## Rendering

### Projection

Orthographic axonometric. Three axes:

- **Time** — a floor edge running down-right, increasing toward the viewer.
- **Frequency** — the other floor edge, running up-right.
- **dB** — straight up.

The floor is the rhombus these two horizontal axes span; grid lines are their subdivisions.

### Draw order

Oldest ridge first, newest last. Because time increases toward the viewer, painter's algorithm makes
the newest frame unoccluded — which is the frame live monitoring cares about most.

### Ridge construction

Each ridge is one closed path: along the spectrum, then back along its floor baseline. Fill with the
resolved panel background colour (this *is* the hidden-line removal), then stroke.

- `Colorize` **off**: one stroke per ridge in the theme foreground colour.
- `Colorize` **on**: one stroke per ridge using a **shared vertical `CanvasGradient`**, built once per
  repaint from `colormapLut` and reused for every ridge by translating the canvas to that ridge's
  baseline before stroking. Gradient coordinates resolve against the transform in effect at paint
  time, so the translate carries the gradient with it.

  This works because colour and height are both functions of dB, and orthographic projection makes
  dB→screen-height one linear map for the whole scene. The obvious alternative — splitting each ridge
  into same-colour runs and stroking each run — was measured on paper at roughly 4400 stroke calls per
  repaint and rejected; see Performance Model.

### Frequency sampling

`buildYToBand(bands, pointCount, minHz, maxHz)` is reused unchanged — its second parameter is just
"how many sample points", so passing 250 yields 250 frequency points. 2D and 3D therefore share one
frequency mapping and cannot drift apart.

### Ridge count

Not user-configurable. It is a performance parameter that looks like an aesthetic one; exposing it
hands the user a control that can destroy the frame rate. Derived from canvas width instead, so
density grows naturally with panel size.

Starting targets: **R ≈ 120 ridges, P ≈ 300 points**, both scaled from canvas width and capped there.
Cost tracks the product R×P, so the two can be traded against each other freely while tuning the look
— more ridges reads as denser time resolution, more points as finer spectral detail.

P is a decimation of the 958 available bands, roughly 3:1. Note the asymmetry with 2D, which maps
bands to *canvas rows* via `buildYToBand` and therefore over-samples them on a tall panel. 3D
deliberately carries less spectral detail than 2D — another reason it is not a readout view.

### Fallback algorithm: floating horizon

If polygon fill turns out to be the bottleneck (see Performance Model), the escape route is to change
algorithm rather than to lower the knobs.

**Floating horizon** maintains the silhouette envelope of everything drawn so far and draws only the
portion of each ridge that rises above it. There is no overdraw and **no fill at all** — pure strokes
produce correct hidden-line output, at O(R×P).

It is not the default because it is materially more code, and because it interacts with the shared
gradient above: clipped ridge segments still stroke against the same vertical gradient, but the
"fill with background colour" step that currently creates the solid look disappears, so the surface
reads as a wireframe rather than a solid. That is a visual change, not just an optimisation.

### Canvas text and DPI

`useCanvasSize` sets `canvas.width = clientWidth * devicePixelRatio`, so the canvas coordinate system
is **device pixels**. The 2D path never noticed because it writes `ImageData` directly. The 3D path
draws text, so `ctx.font` sizes must be multiplied by DPR.

Consequence worth a code comment: per the Windows text-scaling pitfall in `AGENTS.md`,
`devicePixelRatio` inside the webview already includes the Accessibility text-size factor. Axis
labels sized off DPR therefore track the user's text-scaling setting automatically. That is correct
behaviour and must not be "fixed".

## Performance Model

Paper estimate, done before implementation. Recorded here because two of its conclusions changed the
design rather than merely reassuring us about it.

### Measured parameters

| Parameter | Value | Source |
|---|---|---|
| Bands per frame | **958** | `GRID_POINTS_PER_OCT = 96` over 9.97 octaves (20 Hz – 20 kHz) |
| Spectrum frame rate | **25 Hz** | `VISUAL_HIST_SAMPLE_SEC = 0.04` |
| Master timeline rate | 10 Hz | `HIST_SAMPLE_SEC = 0.1` |

### Two budgets, not one

Because data arrives at 25 Hz and the window advances at 10 Hz, the repaint-skip cache holds a live
3D view at ~25 repaints/second. Display rate is only reached while the user is actively dragging or
rotating.

- **Steady state (live monitoring): 40 ms per repaint**
- **Interactive transient (drag, rotate): 16.7 ms per repaint**

### Cost breakdown

With R = ridge count, P = points per ridge. Assuming a maximised panel at roughly 3000×1200 device
pixels, with the projected frequency axis spanning ~1500 px.

| Item | Scale | Estimate |
|---|---|---|
| Grid sampling | R×P array reads + R binary searches | < 1 ms |
| Projection | R×P × ~4 flops | < 1 ms |
| **`lineTo` calls** | **R×P JS→C++ boundary crossings** | **dominant CPU cost** |
| **Polygon fill** | **R × 1500 px × mean height, with overdraw** | **dominant GPU cost** |
| Stroke | R polylines, 1 px wide | small |
| Gradient (Colorize on) | 1 per repaint | negligible |

At **R = 120, P = 300** (36,000 points):

- `lineTo` at 100–200 ns each → **4–7 ms**
- Fill ≈ 54 Mpx with hardware acceleration → **~5 ms**
- **Total ≈ 10–12 ms**

Comfortable against the 40 ms steady-state budget; adequate but not generous against 16.7 ms.

### Calibration against the existing 2D path

The most reliable anchor available. `paintSpectrogramImageData` writes `ImageData` **per pixel**:
at 3000×1200 that is ~3.6 M loop iterations and ~14.4 M byte writes per repaint — and it already runs
at 25 Hz in production without complaint.

The 3D path's 36,000 points are **two orders of magnitude less** JS arithmetic. The risk therefore is
not arithmetic; it is that 3D trades pure typed-array writes for canvas API calls and GPU fill. The
former is known affordable, the latter is not yet measured.

### Principal uncertainty

The fill estimate assumes WebView2's Canvas 2D is hardware-accelerated. Under software rendering,
54 Mpx per repaint will not hold — and that depends on the machine and its drivers, not on anything
this code controls. Floating horizon (see Rendering) exists precisely for that case.

## Interaction

### Gestures

| Gesture | 2D | 3D |
|---|---|---|
| Left-drag (chart) | Pan timeline | Pan timeline — unchanged |
| Wheel (chart) | Zoom time window | Zoom time window — unchanged |
| Ctrl+wheel / Ctrl+drag | Frequency range | Frequency range — unchanged |
| Double-click | Return to latest | Return to latest — unchanged |
| **Right-drag** | none | **Rotate (azimuth + elevation)** |
| Left axis rail | Frequency range | **Height Gain** |
| Bottom axis rail | Time window | Time window — unchanged |

Right-drag is the only added gesture. The left rail is the only changed one; this is a deliberate,
narrow exception to the "no gesture drift" principle in Decision 7, taken because the rail is rarely
used and because the reassignment makes its position semantically correct.

`Reset View` lives in Panel Settings rather than on double-click, which keeps "return to latest". It
restores **azimuth and elevation only** — height gain, colorize, frequency range and time window are
left alone, so recovering from a disorienting viewpoint does not also undo unrelated tuning.

### Axis rails

Both rails keep their handlers and their screen position in 3D; only their labels change. Hiding
them would remove adjustment entry points and make the chart area reflow on every mode switch.

Tick values move into the canvas, drawn along the projected axes.

### Suppressed in 3D

| Element | 3D behaviour |
|---|---|
| Hover crosshair and readout popover | Off |
| Frequency-channel marker lines | Hidden |
| Data-boundary dashed lines | Hidden |
| `TimelineLatestEdgeHint` | Kept — it is edge-anchored, not projection-dependent |
| Selection line (`selLineX`) | Replaced by highlighting the selected ridge |

Selection needs the replacement, not plain removal: without it, scrubbing to a past moment gives no
feedback about which frame is selected. The selected ridge is stroked in
`--ui-loudness-selection` and thickened.

## Panel Controls

| Key | Default | Range |
|---|---|---|
| `spectrogram3d` | `false` | boolean |
| `spectrogram3dColorize` | `false` | boolean |
| `spectrogram3dHeightGain` | `1.0` | 0.3 – 3.0 |
| `spectrogram3dAzimuthDeg` | `45` | 0 – 360, wraps |
| `spectrogram3dElevationDeg` | `22` | 5 – 70, clamped |

Elevation is clamped at both ends: at 0° the surface collapses to a line; above ~70° it degenerates
into a skewed top-down view that is strictly worse than 2D.

`spectrogram3dColorize` defaults to **off for aesthetic reasons, not performance ones** — the first
impression of 3D mode is the classic monochrome mesh. Worth stating explicitly because the shared
gradient makes colorize effectively free, so a future reader must not "optimise" the default by
assuming it was set for cost.

These ride along with the existing `panelControls` persistence path. **No new persisted key is
introduced**, deliberately — per `AGENTS.md`, choosing the wrong persistence domain fails silently by
letting a reset take the wrong data with it.

Settings labels use Title Case (`3D View`, `Colorize`, `Height Gain`, `Reset View`); `aria-label`s
stay lowercase.

## Testing

Unit tests in `src/math/spectrogram3dMath.test.js`:

- **Projection** — known viewpoint and point map to known screen coordinates; azimuth 0/90/180/270
  symmetry holds.
- **Parameter clamping** — elevation bounds, azimuth wrap past 360, height gain bounds.
- **Grid sampling** — timestamp boundary alignment; **data gaps stay empty rather than being
  interpolated**; ridge count is exact after downsampling.

No test for `useSpectrogram3dCanvas.js`, matching the existing treatment of `useSpectrogramCanvas.js`.

### Performance gate

To be verified **after the renderer works and before settings wiring** — a failure here changes the
design rather than being patched afterwards.

- **Method:** `npm run desktop` with real capture, panel maximised, time window at its longest
  (worst case). Synthetic-data benchmarks do not count.
- **Pass:** repaint completes within **40 ms** in steady state and within **16.7 ms** while dragging
  or rotating. Measure the repaint itself, not the observed frame rate — at 25 Hz data an idle 3D
  view is *supposed* to skip most display frames, so a "25fps" reading is the design working.
- **Fallbacks, in order:** lower R and P (total points is what costs, so trade them freely) →
  switch to floating horizon if fill dominates → accept a throttled repaint during rotation only.
- **Not a fallback:** forcing `Colorize` off. The shared gradient makes it free; if it ever appears
  to help, the gradient has been implemented wrong.
- **Not a fallback:** shortening the time window. That would silently reverse Decision 3.

### CI coverage

This change is entirely frontend, so the `AGENTS.md` warning that the capture layer ships untested
does not apply here — a green `npm run check` is genuinely green. `soak:capture` is not needed, as
nothing in the capture layer changes.

## Acceptance Criteria

1. 2D mode behaves identically to before, item for item.
2. Scrubbing in 3D visibly highlights the selected ridge.
3. Switching modes preserves frequency range and time window.
4. Viewpoint, height gain, and colorize survive preset save/load.
5. Real time gaps render as empty space in 3D, as they do in 2D.
6. `npm run check` passes.
