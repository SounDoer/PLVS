# Dock flexibility: first implementation

The first increment removes the fixed 160 px Dock height ceiling and aligns Spectrum with the
workspace panel at every height. Other panels retain their existing presentation.

- Resolve height against the destination display, leaving room for the toolbar and editor.
  Recover the Dock's own Windows reservation before calculating available space.
- Keep saved heights portable; resolve oversized requests at the native window boundary.
- Reuse the workspace Spectrum throughout Dock, including grid, peak labels, hover,
  range gestures, and hold smoothing. Keep Max Hold through resizing. Dock never displays X/Y axes.
- Keep Dock controls independent from workspace controls. Settings preferences survive resizing.
- Share snapshot state with the normal workspace: Spectrum click selects, double-click exits,
  and Snapshot automatically reveals the toolbar Transport return action without changing strip widths. Dock entry and exit preserve selection.
- Resolve keyed plots and freeze timeline views from that shared snapshot while capture continues.
- Update Agent Control, portable configuration validation, and the user guide together.
- Verify native geometry and frontend contracts, and compare Agent Control screenshots at
  compact and expanded sizes before and after the change.

Follow-up panels: Level, Loudness, Waveform, Spectrogram, Vectorscope, Stereo Map, Stats, Transport.
Timeline panning and scrub gestures remain follow-up work; snapshots use the existing shared model.

## Spectrum review and principles for subsequent panels

Spectrum's first alignment pass is complete: Dock mounts the same `SpectrumPanel`, shares its
rendering, range gestures, hold smoothing, Max Hold and snapshot resolution, and exposes the shared
control definitions for Channel, View, Speed, Octave Smoothing, Tilt, Max Mode, Grid and Peak Labels.
The chart keeps those capabilities at all supported heights. Snapshot entry reveals the separate
toolbar without changing panel widths; a generation acknowledgement orders content before native
show, and hidden content is retained during native hide.

Intentional boundaries remain: Dock omits X/Y axis rails, has its own layout, spacing, instance
controls and initial defaults, and does not join workspace frequency-axis linking. Settings reuse
control rows and validation, but retain a Dock editor shell and custom Channel/View selectors; the
normal View selector's colored legend is not yet shared. Core parity does not mean identical
settings presentation or synchronized saved values. Other panels received snapshot data plumbing,
not a complete interaction/settings alignment pass.

Apply these principles to each subsequent panel:

- Inventory data, rendering, interactions, settings and state transitions separately. Record every
  retained difference and its product reason instead of assuming everything compact is exempt.
- Share the renderer and behavior where practical. Adapt layout at the boundary; do not maintain a
  second implementation merely because the panel is docked.
- Let available space change arrangement and annotation density, not silently disable features or
  rewrite saved preferences at arbitrary height thresholds. Keep X/Y axes hidden in Dock.
- Share setting definitions, defaults/validation semantics and conditional availability. Independent
  instance values and intentional first-run defaults may remain; shared implementation does not
  require linking configurations.
- Use the common snapshot selection and keyed history, keep capture running, and show missing data
  rather than falling back to live readings. Preserve selection across window-form changes.
- Make temporary UI reversible and layout-stable. Distinguish temporary reveals from explicit user
  state, reject stale asynchronous acknowledgements, and order content and native visibility.
- Validate short/tall layouts, resize continuity, live/stopped snapshots, repeated entry/exit and
  settings changes. Use behavior tests plus real Agent Control screenshots; tests alone do not
  establish visual parity. Update user documentation and Agent Control together where applicable.

Review the remaining panels one at a time before implementation; timeline navigation and
Vectorscope hold-slow behavior remain explicit follow-up items, not completed Spectrum work.
