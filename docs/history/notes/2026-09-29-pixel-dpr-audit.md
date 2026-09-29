# Pixel / DPR / screen-space size audit

Date: 2026-09-29. Scope: every renderer under `src/` that draws a line, point, grid or image
(Canvas 2D, WebGL2, SVG, CSS borders), plus the hooks that size canvases. No code was changed.

Working principle under test: a product size ("grid stroke = 1 px") means **1 CSS px of final
screen-space visual size**, independent of DPR and of how the renderer is built.

## 1. Data flow

```
Windows display scale x Windows text scale
            |
            v
WebView2 window.devicePixelRatio  (Tauri zoom hotkeys are off; Interface Size only swaps font /
            |                      icon tokens, it never changes DPR)
            v
CSS layout, CSS px  -- tokens --ui-*-stroke-width are unitless numbers that mean CSS px
            |
   +--------+----------+-------------------+----------------------+-------------------+
   |                   |                   |                      |                   |
 SVG (viewBox,      CSS borders        Canvas 2D,             Canvas 2D,          WebGL2
 preserveAspect=    (crosshair,        device-space,          anisotropic         (Spectrogram 3D
 none, non-scaling- latest-edge hint)  identity transform,    backing (Waveform)  Surface)
 stroke)                               explicit x dpr         X cap 1, Y full     framebuffer =
 browser rasterises Chromium snaps     (StereoMap, Polar,     DPR, no transform   device px,
 at DPR             widths to device   persistence, 3D Lines)                     gl.LINES =
                    px                                                            1 device px
```

Canvas backing stores are sized by three separate mechanisms:

| Mechanism                                                      | Used by                                                          | Measures                                                              | Rounding                   | Re-measures on                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------- | ------------------------------------------ |
| `useCanvasSize` (`src/hooks/useCanvasSize.js`)                 | Waveform panel + dock, Spectrogram 2D/3D panel, Dock Spectrogram | container `clientWidth/Height` (integer) x dpr, optional per-axis cap | none (implicit truncation) | ResizeObserver on container                |
| `useObservedCanvasSize` (`src/hooks/useObservedCanvasSize.js`) | Vectorscope polar plot, Vectorscope persistence canvas           | canvas `clientWidth/Height` x dpr                                     | `Math.round`               | ResizeObserver on canvas + `window.resize` |
| `measureCanvas` (`StereoMapPlot.jsx:399`)                      | Stereo Map panel + dock                                          | canvas `clientWidth/Height` x dpr                                     | `Math.round`               | ResizeObserver on canvas                   |

No renderer uses `ctx.scale(dpr)` / `setTransform(dpr, ...)`. Every Canvas renderer works in
backing-store (device) pixels. That is a real, consistent convention in the code, but it is written
down nowhere: `docs/` has no DPR content, and `useSpectrogram3dCanvas.js:340` cites "the DPI note in
AGENTS.md", which no longer exists.

## 2. Inventory and verdicts

### Correct

| Location                                                      | Element                                      | Why it is correct                                             |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `SpectrumPanel.jsx:844-929`                                   | grid, live traces, max-hold hit path         | SVG, `vector-effect="non-scaling-stroke"`, widths are CSS px  |
| `LoudnessHistoryChart.jsx:279-335`                            | grid, M / ST paths, reference, selection     | same                                                          |
| `SpectrogramPanel.jsx:643-684`                                | boundary / frequency markers, selection line | same                                                          |
| `WaveformPanel.jsx:514-524`                                   | selection line                               | same                                                          |
| `VectorscopePanel.jsx:342-380`                                | Lissajous grid, live trace                   | same                                                          |
| `DockSpectrum.jsx`, `DockLoudness.jsx`, `DockVectorscope.jsx` | traces, grids, reference                     | same                                                          |
| `ChartCrosshair.jsx`, `TimelineLatestEdgeHint.jsx`            | crosshair, latest-edge line                  | CSS `border` 1px                                              |
| `StereoMapPlot.jsx:636, 559/643/675`                          | baseline `dpr`, curve + hold `token x dpr`   | device-space canvas, every length scaled                      |
| `VectorscopePolarPlot.jsx:57, 192, 195`                       | point radius, trace, padding                 | `*_CSS_PX x dpr`                                              |
| `VectorscopePanel.jsx:271`                                    | persistence trace                            | `token x dpr`                                                 |
| `useSpectrogram3dCanvas.js:302, 366, 380`                     | Lines floor grid, axis-label font and offset | `lineWidth = dpr`, `font = fontPx x dpr`                      |
| `SpectrogramPanel.jsx:137-150`                                | 3D pointer unprojection                      | converts CSS px to backing px via `canvas.width / rect.width` |
| `spectrogram3dGlUniforms.js:35` + shader `dFdx`               | Surface slope shading                        | derivative per device px x gain in device px, DPR-invariant   |
| `useSpectrogram3dCanvas.js:852-857`                           | Surface scrub band width                     | numerator and denominator both device px                      |
| `useSpectrogramCanvas.js`                                     | 2D heatmap                                   | pixel image, no strokes                                       |
| `commands.js:135-156`, `dock.rs:115-120`                      | dock accessory geometry                      | sends webview DPR (includes text scale), documented           |

### Definitely wrong

**W1. Waveform stroke under an anisotropic backing store (panel + dock).**
`WaveformPanel.jsx:141, 187, 217, 223`; `DockWaveform.jsx:162, 190, 196`.
Since `03f89440` (2026-07-22) the backing store is `X x 1` but `Y x DPR`
(`maxDevicePixelRatioX: 1`). `lineWidth` is set in backing px with an identity transform, so after
the canvas is stretched back to CSS size the pen is an ellipse: **N CSS px wide horizontally but
N / DPR CSS px vertically**. Consequences at DPR 2:

- the centre grid line (`lineWidth = 1`, horizontal) renders at 0.5 CSS px;
- the trace is 1 CSS px on steep transients and 0.5 CSS px on flat or quiet stretches, so its
  weight depends on slope;
- the centroid line has the same defect.

The comment at `WaveformPanel.jsx:215-216` was true when `d1b55d1b` wrote it (both axes capped) and
became false with `03f89440`. `DockWaveform.jsx:110` already converts the row gap by `vScale`
but not the stroke.

**W2. Spectrogram 3D Surface floor grid is 1 device px; Lines floor is 1 CSS px.**
`spectrogram3dGlRenderer.js:344-346` draws the floor with `gl.LINES` (always 1 device px; WebGL
line width above 1 is not available on ANGLE). `useSpectrogram3dCanvas.js:302` draws the Lines
floor with `lineWidth = dpr`. On a DPR 2 display, switching Lines to Surface halves the grid weight.
The comment at `spectrogram3dGlRenderer.js:109` ("switching renderers cannot move the grid") holds
for position only.

**W3. The convention is undocumented and one pointer is stale** (`useSpectrogram3dCanvas.js:340`).

### Suspicious or needing a decision

| #   | Location                                                       | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | `useSpectrogram3dCanvas.js:62-80`                              | Ridge = 1 **device** px. A measured, documented perf trade (hairline fast path). Under the CSS-px rule this is an exception that should be named as one.                                                                                                                                                                                                                                                                                                                                   |
| S2  | `useSpectrogram3dCanvas.js:117-123, 622, 649, 774`             | `ridgeCountFor(W)` / `pointCountFor(W)` take device width: at DPR 2 the ridge count doubles (to the cap), so ridge spacing in CSS px and CPU/GPU cost change with DPR. Density semantics are undecided.                                                                                                                                                                                                                                                                                    |
| S3  | `useSpectrogram3dCanvas.js:685`                                | Selected ridge and Surface scrub band are **2 x** `--ui-spectrum-stroke-width` CSS px. Comments at 679-683 and 943-945 say "the themed width". `57e53fb5` suggests 2x is intended; the spec needs to say so.                                                                                                                                                                                                                                                                               |
| S4  | `VectorscopePolarPlot.jsx:197`                                 | Polar grid = `max(0.5, 0.5 x token)` CSS px (0.6 CSS px at the default 1.2). Every other chart grid, including the Lissajous grid in the same panel, is 1 CSS px.                                                                                                                                                                                                                                                                                                                          |
| S5  | `useCanvasSize.js`, `StereoMapPlot.jsx:536-539`                | DPR can change while the CSS box stays the same (moving between monitors with different scales, changing Windows text scaling). These paths observe only the CSS box, so the backing store can keep the old DPR until the next resize. `useObservedCanvasSize` also listens to `window.resize`; whether that fires in this case in WebView2 is unverified. Nothing listens to `matchMedia("(resolution: ...)")` or uses `devicePixelContentBoxSize`. **Needs a real multi-monitor check.** |
| S6  | `useCanvasSize.js:28-29`, `useSpectrogram3dCanvas.js:286, 678` | Backing size is integer-CSS `clientWidth x dpr`, truncated, not the fractional CSS box. The 3D code then back-derives `dpr = W / clientWidth` and clamps it to 1 or above. The mismatch is below 1 device px (a slight resample blur on 1 px lines), but three hooks do the same job three ways.                                                                                                                                                                                           |
| S7  | `WaveformPanel.jsx:304-313` vs `:631`                          | Bucket count comes from the lanes width minus the fractional rail width, rounded. The backing width comes from the lane container's integer `clientWidth`. These can differ by one column, which breaks the "one bucket per backing pixel" assumption at the edge.                                                                                                                                                                                                                         |
| S8  | all                                                            | Nothing snaps positions to device pixels. A 1 CSS px line at a half-pixel position (`cy = H / 2`, SVG tick y) renders as two device px at half alpha. A decision is needed on whether "1 px grid" implies "crisp".                                                                                                                                                                                                                                                                         |
| S9  | CSS borders vs SVG                                             | At fractional DPR (1.25 or 1.5), Chromium floors `border` widths to whole device px, while an SVG non-scaling 1 px stroke is antialiased at 1.25 or 1.5 device px. The crosshair and the SVG grid therefore differ slightly. This is platform behaviour and belongs in the documentation.                                                                                                                                                                                                  |
| S10 | `ThemePreview.jsx:77-89`                                       | `strokeWidth="2"` without non-scaling, in a uniformly scaled (`meet`) thumbnail, so the stroke scales with the thumbnail. That fits an illustration; the rule should exempt it explicitly.                                                                                                                                                                                                                                                                                                 |
| S11 | `DockSpectrogram.jsx:41`, Waveform X                           | DPR caps for performance. These affect image resolution only and are fine as long as they never change stroke weight (compare W1).                                                                                                                                                                                                                                                                                                                                                         |

## 3. Proposed convention (for review, not adopted)

1. **Unit of intent.** Every product-facing size (tokens, named constants, specs, design docs) is
   CSS px, meaning final screen-space size. Constants carry the unit in the name: `*_CSS_PX`
   (existing examples: `POINT_RADIUS_CSS_PX`, `PLOT_PADDING_CSS_PX`). A device-px value exists only
   as a local that is derived at draw time.
2. **Effective scale, per axis.** A renderer derives `scaleX = backingWidth / cssWidth` and
   `scaleY = backingHeight / cssHeight` from its own canvas. It never reads `window.devicePixelRatio`
   inside draw code, because a capped backing store makes the global wrong.
3. **Canvas 2D.** Each renderer uses exactly one of two patterns and says which:
   - _device space_: identity transform, and every length is multiplied by the scale (current
     practice); or
   - _CSS space_: `setTransform(scaleX, 0, 0, scaleY, 0, 0)` once, and every length is in CSS px.

   With anisotropic scales, strokes must be made under `setTransform(scaleX, 0, 0, scaleY, 0, 0)`
   (the path may still be built in device space) so the pen is round in CSS px. The two patterns are
   never mixed in one renderer.

4. **SVG.** In any stretched viewBox (`preserveAspectRatio="none"`), every stroke uses
   `vector-effect="non-scaling-stroke"`, and width and dasharray are CSS px. Icons and illustrative
   thumbnails that scale uniformly are exempt, because their stroke is meant to scale with them.
5. **WebGL.** Framebuffer and viewport are in device px. Any CSS-px spec that enters a shader
   arrives with an explicit `pixelScale` uniform. `gl.LINES` / `gl.POINTS` sizes are 1 device px, so
   they are allowed only for declared device hairlines; anything with a CSS-px width is geometry.
6. **Declared exceptions.** A device-px visual size must be a named constant (`*_DEVICE_PX`) with its
   rationale at the definition and an entry in the architecture doc. Candidates today: the 3D Lines
   ridge (S1), and possibly the Surface floor (W2) if it is accepted rather than fixed.
7. **Backing-store sizing.** One hook: measure the canvas's own box, backing =
   `round(cssSize x dpr)` (prefer `devicePixelContentBoxSize` when it is available), re-measure on
   DPR change. Per-axis caps stay allowed for performance, and a cap may change resolution but never
   visual stroke weight.
8. **Density parameters** (buckets, ridge and point counts, decimation) state whether they are per
   CSS px or per device px. Visual density defaults to per CSS px. Image resolution may be per device
   px.
9. **Minimum weight.** Grids, axes and guides are 1 CSS px. Strokes thinner than 1 CSS px exist only
   as declared exceptions.
10. **Interface Size** scales typography and iconography only. Stroke and grid widths do not follow
    it. (To be confirmed.)
11. **Tests.** Renderer tests run at DPR 1, 1.25 and 2 and assert that `lineWidth` equals
    `token x scale` on the relevant axis.

## 4. Open decisions

- D1. W1: make the Waveform pen isotropic (stroke under `setTransform(1, 0, 0, scaleY, 0, 0)`), or
  give the stroke a different model.
- D2. W2: accept the Surface floor as a device hairline, or build it as 1-CSS-px geometry.
- D3. S1/S2: keep the ridge as a device-hairline exception; choose ridge density per CSS px or per
  device px.
- D4. S3: whether 2x the spectrum stroke is the intended scrub-marker spec.
- D5. S4: move the polar grid to 1 CSS px like every other grid.
- D6. S8: whether grids must be pixel-snapped.
- D7. Where the adopted convention lives: a section in `docs/architecture.md`, plus an ADR for
  "device-space Canvas with explicit scaling" if that pattern is kept.

## 5. Decisions (same day)

- D1: fixed. Waveform panel and dock stroke through `strokeCssWidth`, so every line is round in CSS
  px under the anisotropic backing store.
- D2: fixed (option B). The Surface floor is extruded into quads at `dpr` device px, which matches the
  Lines floor's 1 CSS px.
- D3: kept. The ridge stays a declared 1-device-px exception; ridge density is unchanged.
- D4: changed. The selected ridge and the Surface scrub band use
  `--ui-loudness-selection-stroke-width`, like every other selection line, instead of twice the
  spectrum stroke.
- D5: fixed. The polar grid is 1 CSS px.
- D6: pixel snapping is not required for now.
- D7: the convention lives in `docs/architecture.md` ("Screen-space sizes"). S5 is addressed by
  `watchDevicePixelRatio` in all three sizing paths and still needs to be verified on the user's
  multi-monitor setup.
- Follow-up found in the real app: after D2 the Surface floor still read faint and broken at DPR 1.
  The Agent Control screenshot showed floor pixels darker than the background (19 against 21, where
  Lines measured 33). Cause: the WebGL canvas used `premultipliedAlpha: false` with a blend that had
  already multiplied colour by alpha, so every translucent pixel was composited at alpha squared.
  This dates from the WebGL port (`7b2dddaa`) and also dimmed the quiet-terrain fade band. It was
  fixed by writing premultiplied colour, after which the floor measured 23/32/32 against Lines'
  24/33/32.
