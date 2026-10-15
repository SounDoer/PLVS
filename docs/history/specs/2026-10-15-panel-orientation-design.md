# Four-direction panel orientation

Date: 2026-10-15
Status: Approved product direction; implementation pending.
Branch: `codex/panel-orientation`, rebased onto local `main` at `8a50e0c2`.

## Scope

Extend Orientation to Loudness, Waveform, and Spectrogram Heatmap, and replace Level Meter's
unreleased two-option control with four explicit directions. Normal panels and Dock use the same
behavior. This is a presentation change; audio capture, DSP, analysis identity, and retained history
do not change. This document records the agreed design, not shipped behavior.

## Direction contract

Keep the setting label `Orientation`. Use these options in this order:

| Value | Label | Newest history edge | Level Meter growth |
| --- | --- | --- | --- |
| `left-to-right` | → Left to Right | Right | Low at left, high at right |
| `right-to-left` | ← Right to Left | Left | Low at right, high at left |
| `top-to-bottom` | ↓ Top to Bottom | Bottom | Low at top, high at bottom |
| `bottom-to-top` | ↑ Bottom to Top | Top | Low at bottom, high at top |

For time plots, arrows describe progression from older to newer data. During live scrolling,
existing content moves in the opposite direction. For Level Meter, arrows describe increasing
level. Defaults are `left-to-right` for time plots and `bottom-to-top` for Level Meter.

Do not migrate or alias Level Meter's old `vertical` and `horizontal` values: the control has not
shipped publicly. Missing or invalid stored values use the ordinary control default. This does not
authorize deleting unrelated compatibility behavior.

## Settings and explanatory text

- Leave Level Meter's Orientation row in its existing position, directly after Bar Colors.
- Place the other three Orientation rows immediately above their range section: above Loudness
  Range for Loudness, Frequency Range for Spectrogram, and Time Range for Waveform. Keep the
  remaining range rows and controls in their existing relative order.
- Put the explanation in the existing Orientation label tooltip, not in an extra persistent row.
  Time plots explain that the arrow runs from older to newer data and live history moves the other
  way. Level Meter explains that the arrow runs from lower to higher level.
- Keep labels readable and in Title Case; accessible names follow existing lowercase conventions.
- Use identical option semantics and ordering in ordinary and Dock settings.

## Plot geometry

| Time orientation | Time rail | Value rail | Increasing value |
| --- | --- | --- | --- |
| Horizontal, either direction | Bottom | Left | Up |
| Vertical, either direction | Left | Bottom | Right |

The value means loudness in Loudness, amplitude in Waveform, and frequency in Spectrogram.
Positive waveform amplitude is up for horizontal time and right for vertical time. Reversing time
does not reverse the value axis or relocate the rails. Tick values reverse with the time direction.
All text, tooltips, menus, and numerical readouts stay upright.

Time selection lines are vertical for horizontal time and horizontal for vertical time. Latest and
off-screen selection hints point to the correct chronological edge. Loudness reference lines and
grids, Waveform centroid overlays, and Spectrogram frequency markers use the same mapping as data.
Existing Show Axes behavior remains available in every direction.

Level Meter changes only its growth direction when reversed within an axis. Preserve channel order:
horizontal bars keep the existing top-to-bottom channel order, and vertical bars keep the existing
left-to-right order. Keep readout and channel-label placement stable within each layout. Threshold
colors, maxima, hold markers, and all existing meter modes follow the new growth direction.

## Interaction and state

- Each panel instance owns its orientation through the existing controls and persistence paths.
  Dock uses its existing settings ownership; no global orientation setting is added.
- Orientation changes preserve the time window, history offset, selected timestamp, value ranges,
  layers, running/paused state, and retained samples. They do not create a new analysis request.
- Preserve existing linked and independent viewport behavior. Linked panels share quantities and
  timestamps, even when their screen directions differ; orientation itself is not linked.
- Dragging along time moves content with the pointer. Zoom remains anchored at the pointer's time.
  Existing modifier meanings remain unchanged; map the affected quantity to its displayed axis.
- Hover, selection, value-axis interactions, reset gestures, and edge hints must agree with the
  rendered coordinates. A direction change during a drag ends that gesture without clearing the
  selected time or changing the viewport merely because the coordinate system changed.
- Never automatically change direction when resizing. Reduce tick density through existing adaptive
  rules when space is tight; do not rotate text or introduce automatic direction selection.
- Restore direction through the existing scene/preset and restart persistence paths. Do not add a
  new draft editor or bypass existing blocking-editor protections.

## Spectrogram mode boundary

Orientation affects Heatmap only. Hide the row in Lines and Surface; retain its stored value when
switching modes and restore it on return to Heatmap. It must not reset, transpose, or otherwise alter
the 3D camera. Agent Control may store the Heatmap direction while a 3D mode is active; its schema
description must explain that it is inactive in 3D.

## Coordinate and rendering architecture

Introduce a small pure mapping shared by the three time plots. Its logical time coordinate runs
from 0 (oldest visible) to 1 (newest visible); its logical value coordinate runs from 0 (minimum) to
1 (maximum). Map to/from plot-local screen fractions, excluding axis rails:

| Direction | Screen x | Screen y |
| --- | --- | --- |
| Left to Right | time | 1 - value |
| Right to Left | 1 - time | 1 - value |
| Top to Bottom | value | time |
| Bottom to Top | value | 1 - time |

Keep logarithmic frequency conversion in the quantity layer. Geometry maps fractions, not Hz or dB.
Expose time-axis extent and chronological edges so callers do not independently guess width,
height, or sign. Event handling uses CSS pixels; renderers explicitly convert to backing pixels.
Handle zero-size plots without producing invalid coordinates.

Adapt shared history interaction to consume logical time coordinates. Keep existing 3D floor
unprojection intact and integrate it through the same logical-time boundary where practical.
Do not rotate the entire DOM panel with CSS: axes, text, interaction, and sampling need independent
layout. Local canvas/SVG transforms are permitted when stroke widths remain correct in CSS pixels.

Loudness decimation and Waveform buckets follow the displayed time-axis extent (height for vertical
time), preserving transient extrema. Preserve Waveform's existing pixel-density policy along the
time axis and full appropriate backing resolution across amplitude. Recompute on resize/direction
change without rebuilding retained history.

Spectrogram keeps bounded rendering work and incremental live scrolling for all directions. Cache
identity includes direction and backing geometry. Direction changes invalidate presentation caches,
not analysis/history. Preserve timestamp gaps, subpixel phase, color mapping, and frequency scaling.

## Integration and acceptance

Use shared direction values/options with per-panel controls. Expose `orientation` consistently in
Panel and Dock Agent Control read/describe/patch/reset and app snapshots. Preserve strict validation,
dry-run semantics, revision conflicts, normal business functions, and unrelated settings.

Acceptance requires all four directions for the four panels (Heatmap only for Spectrogram), normal
and Dock settings parity, correct axis/marker geometry, and accurate hover/selection/drag/zoom.
Include mixed orientations with linked time, restart persistence, live and paused history, file
history, empty data, narrow/tall layouts, and scaled displays. Compare Agent Control screenshot
pixels before/after using controlled data; test assertions alone do not establish visual fidelity.

Update the matching user guide and Agent Control contracts with implementation. No desktop release,
website publication, DSP changes, automatic orientation, or 3D direction presets are part of this work.
