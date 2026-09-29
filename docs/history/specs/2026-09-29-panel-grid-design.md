# Panel Grid Design

Date: 2026-09-29  
Status: Approved design; implementation pending

## Context

The Theme role cleanup exposed an inconsistent use of `grid`. Some panels currently paint lines
called grids while others do not, and several of those lines are not grids at all. Before changing
rendering, this design separates the visual semantics, decides which panels actually support a
grid, and then defines their controls and axis correspondence.

The default UI direction is grid-free. A panel that supports a grid exposes it as an opt-in display
choice.

## Definitions

- **Axis:** an X or Y scale, its ticks, and its labels.
- **Grid:** repeated lines projected from the major ticks of a visible axis into the plot region.
- **Reference line:** a single line with a specific value meaning, such as zero or a target.
- **Coordinate frame:** geometry needed to interpret orientation or polarity, such as a
  Vectorscope frame.
- **3D grid:** the spatial floor grid used by the 3D Spectrogram modes.

Having an Axis is necessary but not sufficient for a panel to support Grid. A grid is added only
when projecting the scale into the plot materially helps read the visualization.

## Confirmed cleanup

### Vectorscope

Vectorscope visuals are not optional grids:

- Lissajous diagonals and the Polar outline are coordinate frames.
- The Correlation rail is a scale track.
- These elements remain visible and must not be controlled by a Grid toggle.
- Their current generic `grid` naming must be separated during implementation.

### Waveform

The current center line is a zero reference, not a grid. Remove it from both the renderer and the
Theme grid model. Waveform will not expose a Grid toggle.

Workspace and Dock both remain grid-free and zero-line-free.

### Stereo Map zero reference

Remove the current unconditional zero line. Where zero is one of the visible Y-axis major ticks,
it may appear as an ordinary grid line when that mode's Grid is enabled. It is not a separate
always-visible reference.

### Spectrogram 3D labels

Keep the existing single Grid toggle for the two 3D modes. It continues to control the current 3D
guide group, including the floor grid and its attached scene labels. Do not add another toggle or
split the current UI behavior.

The Heatmap mode does not expose Grid.

The 3D floor has one grid level. Its outer frame and internal division lines use the same resolved
Grid color and line width. Remove the separate `gridSubtle` / subdivision color role rather than
preserving a special major/minor hierarchy.

### Orphan tuning

The unused `UI_PREFERENCES.modules.spectrum.spectrumGrid` spacing configuration is a cleanup
candidate. Confirm it has no runtime consumer before removing it.

## Confirmed panel support

| Panel / mode                | Grid support                               | Projected axes                                       | State scope                                | Default |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------ | ------- |
| Level Meter                 | No                                         | None                                                 | None                                       | N/A     |
| Loudness history            | Yes                                        | Y only: LUFS major ticks                             | Shared by the panel                        | Off     |
| Stats                       | No                                         | None                                                 | None                                       | N/A     |
| Vectorscope                 | No optional Grid; coordinate frame remains | None                                                 | None                                       | N/A     |
| Spectrum                    | Yes                                        | X frequency and Y dB major ticks                     | Shared across Combined, L/R, and M/S views | Off     |
| Spectrogram Heatmap         | No                                         | None                                                 | None                                       | N/A     |
| Spectrogram Lines / Surface | Existing 3D Grid                           | Existing 3D spatial guide group                      | Shared by the two 3D modes                 | Off     |
| Waveform                    | No                                         | None                                                 | None                                       | N/A     |
| Stereo Map Position         | Yes                                        | X frequency; Y only where interior major ticks exist | Per mode                                   | Off     |
| Stereo Map Correlation      | Yes                                        | X frequency and Y major ticks, including zero        | Per mode                                   | Off     |
| Stereo Map Mono Loss        | Yes                                        | X frequency and adaptive Y dB major ticks            | Per mode                                   | Off     |
| Stereo Map M/S Ratio        | Yes                                        | X frequency and adaptive Y dB major ticks            | Per mode                                   | Off     |

## Confirmed rendering rules

- One Grid toggle controls every supported grid direction in that panel or mode. Do not add
  separate X Grid and Y Grid toggles.
- Draw major grid lines only. Minor-grid behavior is not part of the current design.
- Axis and Grid must consume the same tick model. Grid code must not independently derive another
  scale or tick set.
- Do not draw the outermost tick projections as redundant plot borders.
- Grid remains visible without measurement data when its toggle is enabled; it is part of the
  coordinate presentation, not the data.
- Grid is a display-only choice and must not affect analysis request identity or history slabs.
- All supported grids default to Off.

## Confirmed Theme direction

- Do not add a global user-facing Grid Color.
- Keep one internal shared `data.grid` default and module-local public roles for Loudness,
  Spectrum, Stereo Map, and Spectrogram. Module roles remain independently adjustable in Advanced.
- Remove `waveform.grid`.
- Replace the Vectorscope's Grid role with a non-grid Guides role for its coordinate frame and
  Correlation scale track.
- Stereo Map modes share one Grid color even though their visibility states are stored per mode.
- Remove `data.gridSubtle`, `spectrogram.gridSubtle`, and the subtle-grid recipe.
- Derive the shared default Grid color from the final resolved Panel Surface toward the resolved
  Border Color at the current 8% mix. Do not derive it from the raw Core Surface.
- Render the resolved opaque Grid color at full strength. Components do not add opacity.
- Every Grid line, including the complete 3D floor, uses one CSS-pixel width; Canvas and WebGL
  convert it to device pixels and SVG uses a non-scaling stroke.
- Grid lines are solid. Dashed treatments remain reserved for semantic references, selections,
  crosshairs, and other interaction guides.
- Layer order is Surface, Grid, measurement data, semantic references/selections/holds, then hover
  markers and HUDs.
- Grid is pointer-inert and absent from the accessibility tree. When disabled, its renderer does
  not emit or paint grid geometry.

### Loudness

Loudness projects only the Y-axis LUFS major ticks. It does not project time-axis ticks because
vertical time lines compete with the selection, crosshair, and latest-edge guides without adding
enough reading value.

If an enabled Loudness Profile reference occupies the same Y value as a grid tick, draw the
semantic Reference line without an ordinary grid line underneath it.

### Spectrum

Spectrum projects both axes. Frequency location is a primary reading task, so the X-axis major
frequency ticks are useful references alongside the Y-axis dB grid.

### Level Meter

Level Meter keeps its Y-axis ticks but has no Grid. Lines behind the filled bars are obscured, while
lines above them cut through measurement colors and markers.

### Stereo Map

Grid visibility is stored independently for Position, Correlation, Mono Loss, and M/S Ratio.
Switching modes restores the selected mode's own setting.

The projected Y grid naturally differs by mode because it consumes that mode's visible Y ticks.
Position currently has only endpoint labels, so after redundant boundaries are excluded it mainly
shows the frequency-direction X grid. Correlation includes its zero tick. The two dB modes use
their adaptive dB ticks.

## Workspace and Dock principle

Equivalent visualizations use the same guide semantics, visibility setting, Theme role, and
no-data behavior in Workspace and Dock unless a deliberate compact-layout exception is agreed and
documented. Existing renderer drift is not itself a reason for an exception.

Dock is one such deliberate exception for optional Grid. Its Loudness, Spectrum, Spectrogram,
Waveform, and Stereo Map renderers intentionally omit normal plot axes; the Dock Spectrogram is
Heatmap-only. Because Grid is defined as a visible Axis's tick projection, Dock does not render or
offer Grid for these compact modules. This is not an implementation omission.

Intrinsic non-grid references still agree across surfaces:

- Vectorscope keeps its coordinate frame in both Workspace and Dock.
- Removing the Waveform zero line makes both surfaces zero-line-free.
- Removing the Stereo Map unconditional zero line applies to its shared Workspace/Dock plot.

## Control model direction

Implementation follows the existing flat `panelControls` convention. Loudness and Spectrum each
store one boolean. Stereo Map stores one boolean per mode behind a centralized mode-to-key mapping,
matching the existing per-mode Level Meter control pattern. The existing persisted
`spectrogram3dFloor` key remains unchanged. All defaults are false, and none of these display
controls enters an analysis request key.

The change performs an explicit one-time migration that sets existing `spectrogram3dFloor` values
to false, including saved Workspace panels and Preset panel controls. Preserving an old true value
is deliberately not attempted because persisted controls cannot distinguish an intentional choice
from the former default-on behavior. Old Presets must not silently restore the retired default
after the migration.

## Settings UI

- Each supporting Workspace Panel Settings view exposes one `Grid` switch.
- Loudness places Grid after its layer selection and before axis ranges.
- Spectrum places Grid after its primary display choices and before axis ranges.
- Stereo Map places Grid directly after Mode. The visible row edits the active mode's retained
  value.
- Spectrogram keeps the existing Grid row and behavior in the two 3D modes.
- Dock Settings exposes no Grid row.
- The shared description states that Grid shows lines aligned with the chart axes.

## Theme Editor presentation

- Advanced keeps module-local Grid colors for Loudness, Spectrum, Stereo Map, and Spectrogram.
- Vectorscope replaces `Grid and Axes` with `Guides`.
- Waveform Grid and Spectrogram Grid Subdivisions are removed.
- Theme Preview deliberately shows representative Grid lines while editing these roles even though
  production panel defaults are Off. Preview demonstrates Theme roles; it does not mirror current
  Workspace toggles.

## Public control and compatibility direction

- Presets retain every per-panel and per-mode Grid value. Preset normalization and migration apply
  the same default-off and forced Spectrogram-off rules as Workspace persistence.
- Agent Control exposes complete Grid state for supporting Workspace panels. Loudness and Spectrum
  each expose one boolean, Spectrogram retains `controls.threeD.grid`, and Stereo Map exposes all
  four retained mode values rather than only the currently active one.
- Panel read, describe, patch, reset, coverage, and generated-document contracts must be updated
  together.
- Removing and renaming public Theme override roles uses an explicit Theme semantic migration.
  Preserve the old Vectorscope color under the new Guides role; discard the retired Waveform Grid
  and Spectrogram subdivision overrides with migration notes rather than leaving no-op roles.

## Renderer boundary

- Normalize an axis tick once into its label and plot fraction, then pass that same model to the
  Axis and Grid consumers.
- Exclude only a tick whose projected position lies on the plot boundary; do not blindly exclude
  the first and last tick values because some scales intentionally inset their extremes.
- Shared helpers may own SVG or Canvas paint contracts, but tick selection remains with the panel's
  axis model. Do not force SVG, Canvas, and WebGL through one renderer abstraction.
- Focused tests cover visibility, tick correspondence, mode retention, no-data behavior, layer
  order, full-strength color, and one-CSS-pixel rendering.
- Visual review covers Dark and Light Themes, normal and constrained panels, Grid On and Off, and
  relevant Windows display scales.

## Implementation baseline

The implementation starts after the September 29 renderer-scale fixes already on `main`:

- Canvas backing stores use `useCanvasBackingStoreSize`; new Canvas Grid rendering must not add a
  second size or DPR path.
- Spectrogram Surface floor lines remain extruded one-CSS-pixel quads with the current
  premultiplied-alpha composition. Unifying the two floor colors must not undo that geometry or
  compositing fix.
- SVG Grid uses one-CSS-pixel non-scaling strokes. Do not revive `shape-rendering="crispEdges"` or
  JavaScript position snapping; the recorded experiment made valid Loudness lines disappear.
- Removing the Waveform and Stereo Map reference lines removes the only production consumers of
  `deviceHairline.js`, so that helper and its reference-line-specific architecture text should be
  retired with them.

The current 8% Grid mix is the implementation value. Deterministic visual review may adjust that
single shared percentage before the work is accepted; it must not introduce per-panel strength
exceptions or a second subdivision level.
