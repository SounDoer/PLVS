# Spectrogram 3D Waterfall View — Design

**Date:** 2026-07-28 (rewritten 2026-07-29 to match what shipped)
**Status:** Implemented
**Scope:** Frontend only. `src-tauri` is not touched.

> This document was rewritten after implementation. Several core decisions were reversed while
> building, and a spec that still described the original plan would actively mislead anyone reading
> the code against it. The reversals are recorded in **Reversed during implementation** rather than
> quietly deleted — knowing that hidden-line removal was tried and why it failed is worth more than
> the conclusion alone.

## Summary

A 3D line-waterfall view mode on the existing Spectrogram panel, selected by a per-panel toggle. It
consumes the same snapshot history as the 2D heatmap and shares its time window, so switching modes
never changes *what* data is on screen — only how it is drawn.

The mode is **presentation-first**: it shows how energy evolves over time. It does not replace the
2D heatmap for reading values, and has no hover readout.

## Motivation

The 2D spectrogram encodes magnitude as colour only. Envelope shape over time — attack, decay,
resonant tails, low-end build-up — reads in a waterfall in a way a heatmap does not convey. All the
data is already in the panel; only the rendering differs.

## Non-Goals

- **No hover readout in 3D.** Inverting a rotated projection back to a value under a folded surface
  is unreliable. A wrong number is worse than no number; users switch to 2D to read values.
- **No dock module support.** `DockSpectrogram` renders in a narrow strip where a waterfall would be
  illegible. `src/dock/dockModuleControls.js` is unchanged.
- **No DSP, IPC, or Rust changes.** No new engine request, no new frame field.
- **No WebGL.** Canvas 2D only. The project contains no WebGL at all; introducing it would be an
  architecture-level decision warranting its own ADR. Nothing in the final design needs it — the
  measured worst case is ~3.4 ms per repaint.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | 3D is a **view mode of the Spectrogram panel**, not a new panel | Reuses data source, settings, colormap, time window; smallest increment |
| 2 | Presentation-first; analysis capability deferred | Keeps scope closed |
| 3 | **Follows the existing time window** | Shares scrub, zoom and frozen snapshots with 2D; no second timeline to explain |
| 4 | **Orthographic** projection, not perspective | Perspective compresses the far end of the time axis, and this view shares its window with the 2D heatmap, so unequal time spacing would misread |
| 5 | **Anisotropic** fit — X and Y scaled independently | PLVS panels are wide and short; a spectrogram can be 920×110 device pixels. An isotropic `min()` fit lets the height constraint shrink the whole scene until it occupies a fraction of the width. This is a data plot, not a photograph, and the 2D heatmap already stretches its axes independently |
| 6 | **Unfilled line waterfall** — ridges are stroked, never filled | See Reversed #1 |
| 7 | **Each ridge is a captured frame at its own timestamp** | See Reversed #2 |
| 8 | Colour is **absolute against the fixed dB range**; only height follows the dB floor | dB is encoded twice in 3D (height and colour). A control that moves both leaves nothing stable to read the change against. Colour pinned to absolute level makes it the reference frame |
| 9 | Rotation on **right-drag** only | Left-drag, wheel, Ctrl-combos and double-click keep their 2D meanings. The right-click menu is already suppressed on this canvas |
| 10 | ~~Left axis rail controls **Height Scale** in 3D~~ — **superseded**, see `2026-07-29-spectrogram-3d-axes-and-gestures-design.md` | The vertical screen direction is the dB axis, and it is the only axis that stays vertical under rotation. Sound in isolation; it bought a rail that changes meaning under the user, for a control that had cheaper places to live |
| 11 | Scrub feedback is a **highlighted ridge**, not a selection line | A vertical line through a rotated scene has no meaning |
| 12 | Pointer input is **unprojected onto the floor plane** | See Interaction |
| 13 | Default viewpoint: azimuth 135°, elevation 60° | Frequency on the front-left floor edge, time on the front-right, newest frame at the near corner. See Interaction for the trade this forces |
| 14 | Floor grid and slanted axis labels ship in v1 | They carry most of the perceived finish of this chart type |

## Reversed during implementation

These were decided one way in the original design and changed after seeing real output. Each cost a
round of rework; the reasoning is kept so the same ground is not re-covered.

### 1. Hidden-line mesh → unfilled line waterfall

**Original:** fill each ridge opaquely so it occludes the ones behind (painter's algorithm),
because occlusion is what makes a surface read as solid.

**Why it failed:** occlusion only reads when successive ridges separate enough vertically on
screen, which needs a high elevation angle. A wide, short panel forces a low one, and there the
front ridge's fill swallows the entire interior — you see an outline and nothing else.

**Consequences, all favourable:** dropping the fill removed all overdraw, which had been the
largest unknown in the performance model. It also removed the need to resolve an opaque surface
colour, which had been silently picking up a 55 %-alpha panel background and defeating the
occlusion it existed to provide.

### 2. Fixed-slot sampling → timestamp-anchored ridges

**Original:** cut the window into N fixed slots and ask each which frame covers it — the strategy
the 2D heatmap's long-zoom branch uses.

**Why it failed:** a slot is a fixed screen position that keeps being re-fed with whichever frame
currently covers it. Window movement smaller than one slot produces no visible change at all, and
crossing a slot boundary re-binds every ridge at once. The surface stutters and shimmers instead of
flowing, and no amount of tuning ridge count or spacing removes it, because the stepping is in the
sampling rather than the density.

The 2D heatmap has a second branch that places each frame at the x of its own timestamp. That is
the one this should have copied.

### 3. One shared Colorize gradient → one per ridge

**Original:** since colour and height are both functions of dB, and orthographic projection makes
dB→screen-height one scene-wide linear map, a single gradient could serve every ridge — with a
shear to flatten the sloped baselines.

**Why it failed:** the derivation is sound but incompatible with `Path2D`, which resolves its
coordinates against the CTM at paint time. A shear applied before stroking moves the curve, not
just the gradient. `Path2D` is needed to fill/stroke different shapes from one construction, which
matters more.

**What replaced it:** each ridge builds its own gradient along the baseline's perpendicular — exact,
no transform involved. Measured at roughly +1 ms per repaint, so the optimisation the shear existed
to provide was never needed.

### 4. `useSpectrogramCanvas.js` untouched → touched

The original design guaranteed the 2D renderer would not be modified, so the existing path carried
zero regression risk. The shared **dB Floor** control gave that up deliberately: the spectrogram had
no dB range control at all in either mode, and adding one only to 3D would have left the gap.

The default equals the previous constant, so out-of-box 2D output is bit-identical, pinned by a test
asserting exact pixel bytes.

## Architecture

### `src/math/spectrogram3dProjection.js`

Pure. Orthographic axonometric projection plus the small derivations the renderer and the panel need:

- `clampViewParams` — elevation clamped to 5–85°, azimuth wrapped, height gain clamped.
- `buildProjection` — six affine coefficients, `heightScale`, `ridgeOrderAscending`.
- `labelEdges` — which floor edge each axis label belongs on. Derived, not fixed: pinning an edge
  works at one azimuth and drops a label behind the surface everywhere else.
- `unprojectFloor` — the inverse restricted to the floor plane. Exact 2×2 solve; the determinant is
  `depth · scaleX · scaleY`, non-zero for every allowed elevation.

### `src/math/spectrogram3dGrid.js`

Pure. `sampleWaterfallGrid` selects which captured frames become ridges and reads their levels into
one grid. Decimation buckets by **absolute** time, at a stride quantised to whole frame periods, and
seeds its bucket state from the frame just *outside* the window. Each of those three details exists
to stop a different class of flicker — see Rendering.

### `src/hooks/useSpectrogram3dCanvas.js`

The renderer. rAF loop, `paramsRef` mirror, cached `yToBand`, and a repaint-skip guard. No test, in
keeping with `useSpectrogramCanvas.js` — canvas work is not meaningfully testable under jsdom, which
is why everything testable was pushed into the two math modules.

Publishes the live projection to `projectionRef` so the panel can unproject pointer positions.

### Modified

| File | Change |
|---|---|
| `src/components/panels/SpectrogramPanel.jsx` | View-mode branch, overlay suppression, rail rebinding, right-drag rotation, pointer unprojection |
| `src/hooks/useSpectrogramCanvas.js` | `dbFloor` threaded through; colour via the shared helper |
| `src/theme/spectrogramColormap.js` | New `spectrogramColorFrac(db, dbFloor)`, shared by both renderers |
| `src/lib/panelControls.js` | New keys plus normalizers |
| `src/components/PanelSettingsContent.jsx` | The 3D controls, the shared `dB Floor`, and `Smoothing` unlocked for the spectrogram tab |
| `src/components/panels/chartHelp.js` | Help entries |

`src/workspace/clampPanelControls.js` is **not** modified — it clamps channel selection only.

## Rendering

### Ridges

Each ridge is one captured frame, stroked as an open path at partial-to-full alpha. Painter's order
runs far-to-near, derived from `proj.ridgeOrderAscending` rather than assumed, so the newest frame
lands on top at the default viewpoint.

Ridge and point counts are derived from canvas width and are **not** user-configurable. They were
exposed during tuning and withdrawn: they are performance parameters wearing an aesthetic costume,
and "ridges" versus "points per ridge" is not a distinction users have a model for.

### Three flicker sources, and what each fix addresses

Worth keeping together, because each was found only after fixing the previous one:

1. **Stepping instead of flowing** — fixed-slot sampling. Fixed by anchoring ridges to timestamps.
2. **Ridges blinking on and off** — the decimation stride was derived from `span`, and the window's
   edges are real captured timestamps, so `span` jitters by a few ms per update. Every bucket edge
   shifted and frames near an edge flipped in and out. Fixed by quantising the stride to whole frame
   periods.
3. **The oldest ridge changing shape before it leaves** — the bucket state was seeded with `NaN`, so
   the first frame *inside* the window was always kept regardless of its bucket. As the edge
   advanced, that frame's identity changed every update at an arbitrary phase. Fixed by seeding from
   the frame just outside the window, which makes the selection a pure function of absolute time.

A ridge additionally **fades out** over the last ~2.5 ridge spacings before leaving. Without it a
whole curve at full height blinks out at the edge. The entering end is deliberately *not* faded: the
newest ridge is the frame live monitoring is watching, and easing it in would make the current moment
permanently the dimmest thing on screen. Arrival is the signal; departure is history scrolling away.

### Colour

`spectrogramColorFrac(db, dbFloor)` is shared by both renderers:

```
db <= dbFloor            -> 0
otherwise                -> clamp((db - SPECTROGRAM_DB_MIN) / (SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN))
```

Absolute, so raising the floor never recolours a peak. `<=` rather than `<` is deliberate: it makes a
value sitting exactly on the floor read as the bottom of the ramp, which keeps 2D and 3D consistent
and reproduces the old behaviour exactly at the default floor.

In 3D the gradient runs along the baseline's perpendicular, and each stop recovers the dB its height
fraction represents before taking the absolute colour — so colour is a function of level, not of
screen height.

### Canvas units

`useCanvasSize` sizes the canvas in **device pixels**. Both `ctx.font` and `ctx.lineWidth` must scale
by the ratio or text renders tiny and the mesh washes out to hairlines. The ratio is derived from the
canvas's own dimensions rather than `window.devicePixelRatio`, because `useCanvasSize` can cap it
per axis.

Per the Windows text-scaling pitfall in `AGENTS.md`, `devicePixelRatio` inside the webview already
includes the Accessibility text-size factor, so labels follow that setting automatically. **That is
correct behaviour and must not be "fixed".**

`ctx.font` does not resolve CSS custom properties — an unresolvable value is silently ignored,
leaving the previous font — so the font family is resolved via `getComputedStyle` first.

## Interaction

### Gestures

| Gesture | 2D | 3D |
|---|---|---|
| Left-drag (chart) | Pan timeline | Pan timeline — unchanged |
| Wheel (chart) | Zoom time window | Zoom time window — unchanged |
| Ctrl+wheel / Ctrl+drag | Frequency range | Frequency range — anchored via unprojection |
| Double-click | Return to latest | Return to latest — unchanged |
| **Right-drag** | none | **Rotate** |
| Left axis rail | Frequency range | **Height Scale** |
| Bottom axis rail | Time window | Time window — unchanged |

### Pointer unprojection

Every pointer handler on the chart was written against the 2D projection, where time is the
horizontal screen axis and frequency the vertical one. Under a rotated floor neither holds, and at
the default azimuth both *invert*, so scrubbing selected the mirrored moment and zooming anchored on
the wrong end of the spectrum.

Both now route through `unprojectFloor`. Time selection is remapped at the call site — the shared
history handlers are used by other panels and are not modified; the cursor is translated into the
equivalent 2D-linear horizontal position and delegated via an `Object.create` proxy event.

**The projection works in device pixels and pointer events are in CSS pixels**; the conversion is
required or everything is offset on a scaled display.

### The default viewpoint's trade

Azimuth 135° puts frequency on the front-left floor edge, time on the front-right, and the newest
frame at the near corner — new data emerges at the front and flows away, which is what makes a
waterfall read as one, and it puts the newest ridge last in painter's order.

**The cost is that time then reads right-to-left, the opposite of the 2D heatmap**, so switching
modes flips the time axis. This is a real inconsistency, chosen deliberately over azimuth 315°, which
keeps 2D's direction but pushes the newest frame to the far end. It is noted in the panel help.

Both orientations remain fully usable if the user rotates — labels move to whichever edge faces the
viewer and painter's order follows, verified by an azimuth sweep in the tests.

### Suppressed in 3D

Hover readout, frequency-channel marker lines, and data-boundary lines are hidden.
`TimelineLatestEdgeHint` is kept — it is edge-anchored, not projection-dependent.

## Panel Controls

| Key | Default | Range |
|---|---|---|
| `spectrogram3d` | `false` | boolean |
| `spectrogram3dColorize` | `true` | boolean |
| `spectrogram3dHeightGain` | `1` | 0.3 – 3, surfaced as **Height Scale** |
| `spectrogram3dAzimuthDeg` | `135` | 0 – 360, wraps |
| `spectrogram3dElevationDeg` | `60` | 5 – 85, clamped |
| `spectrogram3dLineAlpha` | `1` | 0.15 – 1 |
| `spectrogram3dLineWidth` | `1` | 0.5 – 3, a multiplier on the device-pixel base |
| `spectrogram3dFloor` | `true` | boolean, surfaced as **Grid** |
| `spectrogramDbFloor` | `SPECTROGRAM_DB_MIN` | −96 – −12, **applies to both modes** |

Two controls are labelled differently from their key, because the key borrowed a word that is
already taken elsewhere in the panel. Both keys keep their original names — they are persisted, and
a migration would buy nothing.

- `spectrogram3dFloor` → **Grid**. It toggles the floor grid; a row reading "Floor" one below
  "dB Floor" implied a relationship that does not exist.
- `spectrogram3dHeightGain` → **Height Scale**. In an audio app "gain" means level amplification in
  dB, and this control does none of that: heights are normalised against the dB floor first, and the
  value is a plain multiplier on that 0–1 relief. Level and colour are untouched. It is vertical
  exaggeration, in the cartographic sense.
  Note the collision it creates *inside* the code: `buildProjection` already returns a `heightScale`
  — the dB→pixel scale derived from the fit. The control is a multiplier applied on top of it, not
  the same quantity.

The elevation clamp exists in two places — the normalizer and the projection — and they must agree,
or the settings layer silently pulls back a value the renderer would accept.

`spectrumOctaveSmoothing` is now exposed on the spectrogram tab. It already travelled in the request
key, so the engine could always deliver smoothed data to the spectrogram; only the control was
missing. It affects both modes.

All of these ride the existing `panelControls` persistence path. **No new persisted domain key is
introduced** — per `AGENTS.md`, choosing the wrong persistence domain fails silently by letting a
reset take the wrong data with it.

## Performance

Measured in a browser harness replicating the draw loop, at the real panel aspect ratios:

| Canvas | Ridges × points | Colorize | Median |
|---|---|---|---|
| 922×110 | 66 × 154 | on | 1.2 ms |
| 2560×900 | 140 × 320 | on | 3.4 ms |
| 3840×1200 | 140 × 320 | on | 3.1 ms |

Against a 16.7 ms interactive budget that is roughly a fifth. Cost saturates past ~1960 px wide
because the ridge and point counts cap.

Colorize costs about +1 ms — the shared-gradient optimisation in Reversed #3 was never needed.

**Caveats:** this is a replica of the draw loop, not the shipped code; Chromium is not WebView2;
there is no competing load from capture, DSP or the other panels; and `sampleWaterfallGrid` itself is
not included. The conclusion survives that error bar, but it does not replace a measurement on the
real app.

### Repaint frequency

Spectrum frames land at 25 Hz and the window advances at 10 Hz, so a live view needs ~25 repaints per
second, not 60. The repaint-skip guard is what enforces that, and **every input that can change the
picture must be in its comparison set** — a missing one produces a control that silently does
nothing, which looks exactly like a frozen render.

## Testing

All testable logic lives in `src/math/`, each module with a matching test, following the repo's
existing split.

Several tests pin invariants rather than values, and were each verified to fail against the
behaviour they replaced:

- Ridges translate uniformly when the window slides, rather than re-binding.
- The same frames stay selected across window jitter.
- Frames leaving the old end do not re-phase the selection.
- Floor coordinates round-trip through projection and back, at every azimuth and elevation.
- Both axis labels land on a front edge at every azimuth.
- Painter's order starts from the far end at every azimuth.
- The default viewpoint's *layout* — frequency front-left, time front-right, newest nearest — rather
  than the angle, so the number can be retuned without a false failure.

### Not covered

- The 3D renderer hook itself, by design.
- Ctrl+drag frequency pan in 3D: the equivalence between a pixel delta and an `fFrac` delta was
  derived numerically, never verified by eye.
- Appearance, in all cases.

## Acceptance

1. 2D mode behaves identically to before, item for item. **This now needs real checking** — the dB
   Floor work touched the 2D renderer, which every earlier version of this design promised not to.
2. Scrubbing in 3D highlights the selected ridge, at the moment the cursor is actually over.
3. Switching modes preserves frequency range and time window.
4. Viewpoint, height scale, colorize and dB floor survive preset save/load.
5. Real capture gaps render as missing ridges.
6. `npm run check` passes.
