# Spectrogram 3D Surface on WebGL — Design

**Date:** 2026-08-31
**Status:** Shipped, with the popping target missed and knowingly accepted — see Acceptance
**Scope:** Frontend only. `src-tauri` is not touched. Surface mode only; Lines and the 2D heatmap
keep their current renderers.

Builds on [2026-07-30-spectrogram-3d-surface-design.md](2026-07-30-spectrogram-3d-surface-design.md),
which shipped the CPU rasteriser this replaces, and on
[2026-07-28-spectrogram-3d-view-design.md](2026-07-28-spectrogram-3d-view-design.md) for the
projection and the data sampling, both of which survive unchanged. The measurements this design
rests on are in `docs/working/perf/spectrogram.md` §1.

## Summary

Draw the Surface as a triangle mesh in WebGL2 instead of walking it per pixel in JavaScript. The
grid, the smoothing, the projection and the colour table stay exactly where they are, in tested
JavaScript; what moves is rasterisation, hidden-surface removal and shading.

## Motivation

Not cost. Surface is 7.5 ms a repaint and 150 ms/s of main thread after the render-scale change,
which is no longer a hotspot. Two other things drive this:

**The surface boils as the window advances, and no affordable parameter fixes it.** Per window
update, 47–48% of the silhouette columns move by a pixel or more. The cause is a per-pixel point
sample of a moving, noisy height field: each pixel picks a different sample of the noise every
update, and the silhouette is a hard threshold rather than a coverage. Measured levers: supersampling
takes the popping from 47.8% to 14.0% but costs 2.3x the repaint, and stronger smoothing gets to
40.2% while blunting real detail. Slope shading was measured and ruled out as the driver.

On the GPU this class of artefact does not arise the same way. The terrain becomes an interpolated
surface rather than a set of point samples, the silhouette becomes geometry with MSAA coverage
rather than an alpha threshold, and shading is computed from screen-space derivatives of that
interpolated surface.

**Two quality debts were taken to buy CPU, and this pays them back.** The ridges run at a
one-device-pixel hairline because anything wider leaves the renderer's fast path, and Surface renders
at 0.75 scale and is stretched. Neither trade exists on the GPU.

The no-GPU objection looked measured and small: under `--disable-gpu`, WebGL2 does not disappear, it
falls back to ANGLE over the Microsoft Basic Render Driver, where a mesh this size costs 13.7 ms a
frame against 1.2 ms on the discrete GPU. That is 1.8x today's CPU cost, not a failure, so no second
renderer would have to be kept alive as a fallback.

> **This did not survive contact with the real renderer, and it was the whole basis for deleting the
> CPU rasteriser.** The 13.7 ms was a synthetic load with a trivial fragment shader. The actual
> Surface renderer under the same `--disable-gpu` produces no picture at all: the context is healthy
> (not lost, no GL error, 4x MSAA, ANGLE/Basic Render Driver) and the panel keeps reporting ~14
> repaints a second at 4.29 ms, but the drawing buffer is frozen — `readPixels` coverage sat at
> exactly 1.16% for 14 seconds where a working frame is ~36%. MSAA, the depth prepass, `UNSIGNED_INT`
> indices and a 320k-triangle mesh were each ruled out by direct experiment in the same software
> driver, all of which render correctly. Root cause unknown. `--disable-gpu` is a synthetic worst
> case and this is not evidence that real GPU-less machines are broken, but the premise is unproven,
> so **the CPU rasteriser stays until it is understood**. Details in
> `docs/working/perf/spectrogram.md` §1.

## Non-Goals

- **Lines mode.** It costs 4.6% of the 3d engine and 1.7 ms a repaint; it has its own advance
  judder (3.5–4.2 px steps) whose mechanism is not understood, and guessing at it inside a rewrite
  would confuse two investigations. Lines stays on canvas 2D.
- **The 2D heatmap.** Untouched.
- **Any change to what is drawn.** Parity with the current look is the acceptance bar, minus the
  boiling and the two quality debts. No new lighting model, no new controls, no rotation UX changes.
- **Raising the row count.** The GPU could carry every captured frame instead of the decimated grid.
  That is a separate change with its own memory and upload questions; this one keeps
  `sampleWaterfallGrid` exactly as it is so the comparison stays honest.
- **File analysis differences.** Same path as live.

## What stays in JavaScript

This list is the answer to the main objection against the rewrite: the logic that is worth testing
stays testable, and CI keeps seeing it.

| Stays                                                                        | Why it can stay                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `sampleWaterfallGrid` (decimation, epoch-anchored buckets, live-row pinning) | Pure data selection; nothing about it is per-pixel                              |
| `smoothGridFrequency`, `smoothGridTime`, `fadeGridFrequencyEdges`            | Operate on the height grid, not on pixels                                       |
| `buildProjection`                                                            | Becomes a 3x3 uniform; the fit itself is unchanged                              |
| `buildSurfaceLut`                                                            | Becomes the contents of a 64 x 256 RGBA texture, still built and asserted in JS |
| `edgeFade` (time ends)                                                       | Evaluated per ROW in JS, multiplied into the grid heights the mesh then reads   |
| `columnFloorSpan`, `buildRowLut`, `rasterizeSurface`                         | Unreferenced — the depth buffer replaced the walk, but see Acceptance: deletion is on hold |

`edgeFade` was going to be a vertex attribute and is not: the fade is a multiplier on height, so
applying it to the grid before the mesh is built is the same arithmetic with nothing to plumb. Note
also that `edgeFade` cannot be deleted with the rasteriser even when that happens —
`fadeGridFrequencyEdges` calls it, and that stays.

The LUT texture is 64 wide by 256 tall, shade on x and level on y, because `buildSurfaceLut` indexes
`level * SHADE_LEVELS + shade`. Uploading it the other way round does not look like a broken table;
it makes the surface shade by slope instead of by level and paints quiet terrain over the floor grid.

Two things move that are not pixels, and both get a new pure module rather than living in a shader:

- **Mesh building** (`spectrogram3dMesh.js`, new): grid → vertex and index buffers. Unit-testable in
  full: vertex count, triangle count, the skirt that closes the solid, how a capture gap becomes a
  hole rather than a stretched triangle, and buffer reuse across repaints.
- **Uniform assembly**: projection matrix, height gain, fade edges, highlight row, theme colours.
  A pure function returning a plain object, asserted directly.

## What moves to the GPU

**Rasterisation.** The grid is `rows x points` vertices, two triangles per cell.

**Hidden-surface removal.** A depth buffer replaces the horizon walk, and with it goes the entire
`resumed` / `horizon` / wall-bound apparatus — the subtlest code in the current rasteriser, and the
source of its hardest bug (the extrusion spilling past the floor's near edge after a capture gap).
The solid look needs a skirt: the terrain's four edges extruded down to the floor plane, built in
the mesh module.

**Shading.** The current headlight model shades by the terrain gradient along the view ray. In the
fragment shader that is `dFdx`/`dFdy` of the interpolated height, which is the same quantity measured
on the interpolated surface instead of on point samples — the reason the boiling should not survive
the move. `slopeShade`'s soft-saturation curve carries over unchanged as shader arithmetic, and the
shade index still lands in the same LUT.

**Antialiasing.** `antialias: true` (MSAA). The silhouette stops being an alpha threshold.

## Compositing and the DOM

The floor grid must sit _under_ the terrain, and today it does because the 2D canvas draws it first
and paints the surface over it. Stacking a WebGL canvas behind a 2D one would put the grid on top.

So: **the WebGL canvas draws the floor grid too** — it is four lines and a few divisions, trivial as
geometry — and a transparent 2D canvas above it keeps the axis labels, which are text and belong on
top anyway. The panel therefore holds two canvases:

```
<div data-leaf-path=...>
  <canvas data-spectrogram-gl>     <- WebGL2: floor grid, terrain, scrub highlight
  <canvas data-spectrogram-overlay> <- 2D: axis labels only, pointer-events: none
```

Pointer handling (rotate drag, scrub) stays on the container exactly as now; both canvases are
`pointer-events: none`. `useCanvasSize` sizes both from the same device-pixel measurement.

Lines and the 2D heatmap keep using the existing single canvas, which stays in the tree and is
hidden in Surface mode. No mode may have two renderers live at once.

## Context loss

A WebGL context can be lost by a driver reset, a GPU process crash, or the browser reclaiming
resources. This is not the no-GPU case and cannot be answered by WARP.

- `webglcontextlost`: `preventDefault()`, mark the renderer dead, stop scheduling repaints.
- `webglcontextrestored`: rebuild programs, textures and buffers from the JS-side state, resume.
- **Two failed restores in one session:** stop, leave the panel dark, and draw a one-line error in
  its place. **Do not silently change the user's Mode**, which was the first proposal and was
  rejected: a meter that quietly starts showing something other than what was asked for is worse
  than one that says it is broken. Switching back to a working mode stays the user's action. No CPU
  surface renderer is kept for this either.

## Testing

What CI can no longer see is the shaders. The mitigation is to keep them thin and to keep everything
they consume asserted:

- Mesh module: full unit coverage, as above.
- Uniform assembly: full unit coverage, including the projection matrix's correspondence with
  `projectPoint` (the same property `spectrogram3dProjection.test.js` already pins for scaling).
- LUT contents: existing `buildSurfaceLut` tests unchanged.
- Shaders: compiled and linked in a smoke check that runs only where a GL context exists — which is
  not jsdom, so it does not run in CI. It runs in the manual checklist below instead.
- The 86 `rasterizeSurface` tests are deleted with the code they cover. The invariants worth keeping
  (a gap contributes no geometry; the newest row is pinned; edge fades sink the terrain at the
  window edges) move to the mesh module's tests, where they are assertions about vertices.

**Manual visual checklist** (no CI substitute exists; run before merging):
rotate through azimuth 0/90/135/270 at elevation 5/30/60; a capture gap mid-window; the scrub
marker on and off; Colorize on and off; a theme switch while running; a window resize while running;
`--disable-gpu`; and the per-update shimmer probe before and after.

## Acceptance

Measured with the instruments in `docs/working/perf/README.md`, same signal, same terrain coverage,
per window update rather than per frame:

|                                    | Target          |     Arm A: CPU |  Arm B: WebGL |
| ---------------------------------- | --------------- | -------------: | ------------: |
| Silhouette columns popping >= 1 px  | **< 15%**       | **39.10%**     |    **35.23%** |
| Main thread per repaint            | <= 4 ms         |        7.10 ms |       3.09 ms |
| GPU 3d engine                      | may rise; < 25% |         12.85% |        17.17% |
| Same, `--disable-gpu`              | <= 20 ms        |         7.3 ms | draws nothing |
| Render scale                       | 1.0             |           0.75 |           1.0 |

Both arms are release builds measured in one session on the same material at the same terrain
coverage (35.6–36.4%): arm A is `cb172a74`, arm B is `54b5b1e6`. The popping figures are the
accumulated-alpha silhouette, not the original `alpha > 8` one — that definition assumes a hard edge
and re-quantises an MSAA ramp, which punishes the renderer exactly where antialiasing is working (it
scores arm B at 56.50% against arm A's 48.88%). The full derivation, and the wrong second attempt
before it, are in `docs/working/perf/spectrogram.md` §1.

**The popping target is missed, by a wide margin, and this was accepted rather than reverted.** The
revert criterion below stood: 47% to under 15% was the whole point, and 39.10% to 35.23% is under 7%
relative. What the rewrite did buy is the two quality debts (render scale back to 1.0, ridges off the
hairline), less than half the main thread, and MSAA making each displacement continuous instead of a
hard one-pixel step. That last one is why the eye and the metric disagree: **the displacement barely
shrank, its rendering became continuous.** The user judged the result acceptable on those grounds
with the numbers in hand. Anyone reopening this should know the boiling is still there.

This also means the mechanism argument in Motivation is only a third right. The three sources of the
shimmer are new rows arriving, inter-row interpolation weights moving, and per-column sample position
drift; WebGL removes the third alone, and the first two are properties of the data pipeline.

## Risks

- **Driver variance.** ANGLE over D3D11 is the only backend WebView2 uses on Windows, which narrows
  this, but shader compilation failures are still possible in the field. Every failure path lands in
  the same place as a lost context: report, do not crash the panel, and **do not change the user's
  Mode** — see Context loss, which this bullet used to contradict.
- **Theme churn.** The LUT is a texture now; a theme switch must rebuild and re-upload it. The
  existing identity-keyed cache already knows when that happens.
- **Resize churn.** Reallocating the drawing buffer on every resize tick is expensive; debounce as
  `useCanvasSize` already does for the 2D path.
- **A second rendering stack to maintain.** Real and unavoidable. Bounded by keeping Lines and the
  heatmap on canvas 2D, and by keeping everything except rasterisation in shared JS.
- **The boiling may not go away.** It did not. The mechanism argument was sound and turned out to
  cover one of the three contributors; see Acceptance for the measured outcome and why it was
  accepted anyway.
