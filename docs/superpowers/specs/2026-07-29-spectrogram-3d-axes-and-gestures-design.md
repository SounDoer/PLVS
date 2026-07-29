# Spectrogram 3D — Axis Rails and Gestures — Design

**Date:** 2026-07-29
**Status:** Implemented
**Scope:** Frontend only. `src-tauri` is not touched.
**Supersedes:** decision #10 of `2026-07-28-spectrogram-3d-view-design.md`.

## Summary

Switching the Spectrogram panel into 3D currently rebinds the left axis rail: it stops being the
frequency axis and becomes a Height Scale drag handle labelled `dB`. This removes that rebinding.
After it, the panel's two axis rails and every chart gesture mean the same thing in both modes, and
the only mode-dependent additions are gestures that occupy positions 2D leaves empty.

## Principle

**Nothing that exists in 2D changes meaning in 3D.** A capability that only 3D has must take a
position 2D does not use.

Measured against it, the current implementation breaks the rule exactly once — the left rail. The
right-drag rotation does not: 2D has no right-drag.

## Motivation

The rebinding was justified by the earlier design's decision #10: the vertical screen direction is
the dB axis, and dB is the only axis that stays vertical under rotation, so the vertical rail should
control it. The reasoning is sound in isolation and wrong in context. It buys a rail whose label,
ticks, gesture and meaning all change under the user, in exchange for putting one 3D-only control
somewhere convenient. Cheaper positions were available and were not taken.

It also left the panel in a state no one intended: the left rail was converted, the bottom rail was
not. So today 3D shows a rail with no ticks that drags a presentation parameter, next to a rail with
full ticks that are geometrically meaningless.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The left rail is the **frequency axis in both modes** | Restores the principle; removes the only rebinding |
| 2 | Rail ticks in 3D state the **range, not the position** | See Accepted inconsistency |
| 3 | Height Scale moves to **Shift+wheel**, plus the existing settings slider | Completes the wheel family: plain / Ctrl / Shift = time / frequency / height |
| 4 | View reset is **right double-click** on the chart | Mirrors left double-click = return to latest: double-click returns that button's axis to its default |
| 5 | The per-row resets in settings **stay** | They answer "put elevation back to 60°", a different question from "I am lost" |
| 6 | The in-canvas `Time` / `Frequency` labels are **unchanged** | See Measured, not assumed |
| 7 | No dB scale is added anywhere | The mode stays presentation-first; reading values means switching to 2D |

## Accepted inconsistency

**In 3D the rail ticks do not correspond to screen positions, and this is accepted rather than
fixed.**

In 2D the screen axes are the data axes, so a tick drawn beside the canvas points at the row or
column it names. In 3D frequency runs along one projected floor edge and time along another; no
screen-vertical or screen-horizontal line corresponds to either. The rails therefore say "the range
on screen is 20 Hz – 20 kHz" and "the window is 30 s", and say nothing about where.

The bottom rail is the sharper case: at the default azimuth time reads right-to-left, so its ticks
are not merely imprecise, they are reversed.

The alternative considered was dropping the interior ticks in 3D and keeping only the two endpoints,
which claims range without claiming position. It was rejected because the tick set would visibly
change on every mode switch, and because nobody reads a rail against a rotated surface in the first
place — the cost being avoided is theoretical and the flicker is not.

This is recorded so it is not later "fixed" by someone who rediscovers the geometry. Making the
ticks true requires drawing them along the projected floor edges inside the canvas, which is a
different feature with a different cost.

## Measured, not assumed

The in-canvas axis labels were suspected of tilting badly at low elevation. They do not. Computed
through `buildProjection` and `labelEdges` at the real panel aspect ratios:

| Canvas | el 15° | el 30° | el 60° | el 85° |
|---|---|---|---|---|
| 922×110 | 1.9° | 3.1° | 4.8° | 6.4° |
| 1200×400 | 5.2° | 8.5° | 13.3° | 17.4° |
| 2560×900 | 5.5° | 9.0° | 14.0° | 18.3° |

Worst case 18°, the common wide-and-short panel under 7°. The tilt also *decreases* with elevation
rather than increasing, because the anisotropic fit stretches a wide panel horizontally and flattens
both floor edges along with the text on them.

So "replace the slanted labels with horizontal ones" would move 5° to 0° and change nothing visible.
The labels stay as they are. They also matter more after decision #2 than before it: once the rails
stop claiming position, these two words are the only thing identifying which floor edge is which.

## Changes

### `src/components/panels/SpectrogramPanel.jsx`

- Remove the `is3d` branch on the Y rail: no `dB` label, no Height Scale pointer handlers, no
  `ns-resize` cursor. The rail renders frequency ticks and takes `spectrogramYAxis.axisHandlers` in
  both modes.
- Delete `heightGainDragRef`, `onHeightGainDrag`, `onHeightGainPointerDown`,
  `onHeightGainPointerMove`, `onHeightGainPointerUp` — orphaned by the above.
- Add Shift+wheel height scaling to the chart wheel handler, 3D only. Multiplicative, reusing
  `CHART_ZOOM_IN_FACTOR` / `CHART_ZOOM_OUT_FACTOR` so it accelerates like the other two wheel
  gestures; the 0.3–3 clamp already lives in `normalizeSpectrogram3dHeightGain` and is not
  duplicated here.
- Add right double-click view reset, 3D only.

### `src/components/panels/chartHelp.js`

The 3D section gains the two new gestures. The Height Scale entry stops calling itself a rail.

### Not modified

`useSpectrogram3dCanvas.js`, `spectrogram3dProjection.js`, `spectrogram3dGrid.js`,
`useSpectrogramCanvas.js`, `panelControls.js`. No new persisted key: Shift+wheel and the reset
gesture both write controls that already exist.

## Two traps

Both are the kind that produce code which reads as correct and does nothing.

### Shift+wheel arrives as `deltaX`

Chrome on Windows swaps a wheel event's `deltaY` into `deltaX` while Shift is held — the convention
for horizontal scrolling. A handler that reads `deltaY` sees zero and the gesture is silently dead.

Read whichever of the two is non-zero. **Verify in the real WebView2 build, not only in `npm run dev`
in a browser**, because this is platform and engine behaviour rather than something the DOM spec
pins down.

### `dblclick` does not fire for the right button

The event is specified for the primary button, so there is no ready-made right double-click. It has
to be assembled: on right `pointerup`, treat it as a double-click if the pointer moved less than a
few pixels during the press *and* the previous right `pointerup` was within the platform
double-click interval (~400 ms).

The movement threshold is not optional. A right press already begins a rotation drag, so without it
a rotate-out-and-back gesture registers as a double-click and throws away the viewpoint the user was
aiming at.

## Gesture table (after)

| Gesture | 2D | 3D |
|---|---|---|
| Wheel | Zoom time | Zoom time |
| Ctrl+wheel | Frequency range | Frequency range |
| **Shift+wheel** | — | **Height Scale** |
| Left-drag | Pan timeline | Pan timeline |
| Ctrl+left-drag | Pan frequency | Pan frequency |
| Double-click | Return to latest | Return to latest |
| **Right-drag** | — | Rotate |
| **Right double-click** | — | **Reset viewpoint** |
| Left rail | Frequency range | Frequency range |
| Bottom rail | Time window | Time window |

Every row that exists in both columns is identical in both. Every 3D-only row was empty in 2D.

## Testing

The math modules are unchanged, so the new coverage is at the panel layer, in
`SpectrogramPanel.test.jsx`:

- In 3D the Y rail renders frequency ticks, and dragging it changes the frequency range rather than
  `spectrogram3dHeightGain`. This is the regression that would reintroduce the rebinding.
- Shift+wheel changes `spectrogram3dHeightGain`, **asserted for `deltaY` and for `deltaX`
  separately** — one test per delivery path, or the trap above passes review.
- Right double-click restores azimuth and elevation to their defaults.
- A right-drag that moves beyond the threshold and releases does not reset.
- In 2D, Shift+wheel and right double-click both do nothing.

### Not covered

- Appearance, as before.
- The real-WebView2 behaviour of Shift+wheel, which no jsdom test can establish.

## Acceptance

1. Toggling 3D changes nothing about either rail's labels, ticks, cursor or drag behaviour.
2. Shift+wheel scales height in 3D, in the shipped desktop app.
3. Right double-click returns the viewpoint to azimuth 135°, elevation 60°.
4. A rotate drag that happens to end near where it started does not reset the view.
5. 2D behaves exactly as before, item for item.
6. `npm run check` passes.
