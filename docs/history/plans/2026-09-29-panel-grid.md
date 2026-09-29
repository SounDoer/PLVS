# Panel Grid Refactor Implementation Plan

Date: 2026-09-29  
Status: Ready for implementation

## Goal

Make `Grid` mean one thing across PLVS: an optional projection of visible major-axis ticks into a
Workspace plot. Default every supported Grid to Off, remove visuals that were incorrectly modeled
as Grid, keep Vectorscope orientation geometry as always-visible Guides, and preserve the existing
single Spectrogram 3D Grid control.

## Design source

`docs/history/specs/2026-09-29-panel-grid-design.md`

## Baseline constraints

- Build on the current CSS-pixel renderer work already on `main`.
- SVG lines use `vector-effect="non-scaling-stroke"`; do not use `shape-rendering="crispEdges"` or
  JavaScript absolute-position snapping.
- Canvas uses `useCanvasBackingStoreSize` and converts one CSS pixel through its returned DPR.
- Spectrogram Surface keeps the current extruded-quad floor geometry and premultiplied-alpha
  composition.
- Dock remains intentionally grid-free because its compact charts do not render normal axes.
- This is frontend presentation and persistence work. It does not change audio requests, DSP, or
  history-key identity, and it requires neither capture smoke nor soak testing.

## Target control shape

Add these booleans to the existing flat panel-control registry, all defaulting to `false`:

```text
loudnessGrid
spectrumGrid
stereoMapPositionGrid
stereoMapCorrelationGrid
stereoMapMonoLossGrid
stereoMapMsRatioGrid
```

Keep `spectrogram3dFloor`, but change its default to `false`. Export a frozen
`STEREO_MAP_GRID_KEYS` map from Stereo Map mode IDs to the four keys, and use it everywhere the
active mode selects a Grid value.

## Task 1 — Add controls and a one-time persisted-state migration

### Production changes

- Update `src/lib/panelControls.js` with the six new booleans, the mode-to-key map, shared Grid
  tooltip text, Settings metadata, and `spectrogram3dFloor: false`.
- Remove the unused `UI_PREFERENCES.modules.spectrum.spectrumGrid` object from
  `src/preferences/data.js` after the final consumer search remains empty.
- Introduce Workspace and Presets domain version constants in `src/persistence/index.js`.
  Version-0 reads must rewrite every stored panel-control record's `spectrogram3dFloor` to `false`
  and return the new version. Apply this to live Workspace panels and every saved Preset before
  normal normalization can fill defaults. A later user choice of `true` under the new version must
  survive subsequent reads.
- Keep the migration idempotent and preserve unrelated controls, malformed-record handling, Dock
  state, Preset metadata, and the existing Workspace/Presets migrations.

### Tests

- Extend `src/lib/panelControls.test.js` for defaults, invalid-value repair, key order, and the
  Stereo Map mapping.
- Extend `src/persistence/index.test.js` with version-0 Workspace and Preset fixtures containing
  missing, `true`, and `false` Spectrogram values; prove the migration forces all three Off once,
  stamps the new version, and preserves a post-migration `true`.
- Update `src/lib/presetWorkspaceView.test.js` and panel-instance normalization tests to prove every
  new Grid value survives Preset application and normalization.
- Add an analysis-request regression assertion that changing any Grid boolean leaves all request
  keys unchanged.

## Task 2 — Normalize Theme semantics and migrate custom Themes

### Registry and compiler

- In `src/theme/themeRoleRegistry.js`:
  - make `data.grid` depend on `interface.border.default` and the resolved
    `interface.surface.panel`;
  - remove `data.gridSubtle` and `spectrogram.gridSubtle`;
  - remove `waveform.grid`;
  - rename `vectorscope.grid` to `vectorscope.guides`, with Advanced label `Guides`;
  - keep the Loudness, Spectrum, Spectrogram, and Stereo Map module Grid roles;
  - rename the Stereo Map Advanced label from `Grid and Axes` to `Grid`.
- Delete the `grid-subtle` recipe from `src/theme/themeRecipes.js`. Keep the shared Grid recipe at
  an 8% mix toward the resolved border color and emit one opaque solid color.
- Update CSS and Canvas bindings/selectors so Vectorscope reads Guides and Spectrogram exposes only
  one Grid color. Regenerate `src/generated/` through the normal theme generator; never edit it by
  hand.

### Semantic migration

- Bump `THEME_SEMANTICS_VERSION` in `src/theme/themeSchema.js`.
- Extend `src/theme/migrations/migrateV1Theme.js` (or split out a clearly named semantic migration)
  to accept format-2/semantics-1 documents, copy a `vectorscope.grid` override to
  `vectorscope.guides`, discard `waveform.grid`, `spectrogram.gridSubtle`, and any retired subtle
  role override, then emit the new semantics version with explicit migration notes.
- Update built-in Themes, portable Theme validation, Theme packs, fixtures, compatibility tests,
  and Theme documentation examples for the new semantics version.
- Update `src/components/theme-editor/ThemePreview.jsx` so the module cards deliberately display
  representative Grid lines for Loudness, Spectrum, Spectrogram, and Stereo Map, while Vectorscope
  demonstrates always-visible Guides. Preview state must not depend on Workspace toggles.

### Tests

- Cover dependency resolution from a customized Panel Surface, exact 8% output in Dark and Light,
  the absence of subtle/Waveform roles, the new Guides bindings, and opaque module role output.
- Cover the semantic migration, including Vectorscope color preservation and deliberate removal of
  retired overrides.
- Update Theme Preview tests to assert representative Grid and Guides are present.

## Task 3 — Share normalized axis ticks with SVG Grid renderers

### Tick contract

- Add a small chart helper/component beside `AxisRail` that accepts normalized ticks shaped as
  `{ key, label, frac }`, filters only projected boundary positions (`frac <= epsilon` or
  `frac >= 1 - epsilon`), and paints pointer-inert, `aria-hidden` SVG lines.
- Keep tick generation in each panel. The helper owns only normalized projection and the common
  one-CSS-pixel SVG paint contract; it must not invent ticks or abstract Canvas/WebGL rendering.
- Build each panel's normalized tick arrays once and pass the same arrays to `AxisRail` and Grid.

### Loudness

- Add `loudnessGrid` to `LoudnessPanel`/`LoudnessHistoryChart` wiring.
- Render only Y lines, before traces. When the visible Profile Reference has the same value as a
  major tick, omit that ordinary Grid line and leave the dashed semantic Reference on top.
- Emit no Grid group when the toggle is Off. Keep the Grid visible in the ordinary no-data chart
  state when On.

### Spectrum

- Add `spectrumGrid` wiring.
- Replace the current unconditional Y-only group with the shared normalized Y ticks plus X
  frequency ticks. Render before fills and traces, omit only actual plot-boundary projections, and
  emit no geometry when Off.
- Verify Combined, L/R, and M/S reuse the same boolean.

### Tests

- Add focused helper tests for boundary filtering, inset extrema, and no pointer/accessibility
  surface.
- Extend `LoudnessHistoryChart.test.jsx`, `LoudnessPanel.test.jsx`, and
  `SpectrumPanel.test.jsx` for Off defaults, On geometry, tick correspondence after range/size
  changes, empty data, reference collision, X+Y Spectrum lines, and render order.

## Task 4 — Add per-mode Stereo Map Grid and remove the zero baseline

### Panel and Canvas work

- In `StereoMapPanel.jsx`, build normalized X and Y tick arrays once, pass them to both Axis rails
  and `StereoMapPlot`, and resolve the active toggle through `STEREO_MAP_GRID_KEYS`.
- Extend `StereoMapPlot.jsx` with `gridVisible`, `xTicks`, and `yTicks`. Include the visibility and
  tick fractions in its redraw signature so resize, zoom, pan, mode changes, and toggles repaint
  correctly.
- After `clearRect`, paint enabled X/Y major lines in the resolved `stereoMap.grid` color at one
  CSS pixel converted by DPR, before fills, curves, and Hold. Exclude projected boundaries and do
  not paint any Grid geometry when Off.
- Remove the unconditional zero-baseline stroke while retaining the exact mathematical baseline
  used to close area fills. Correlation zero then appears only through its enabled Y Grid tick.
- Position mode naturally produces only interior X lines while its endpoint-only Y ticks are
  filtered as boundaries.

### Cleanup caused by reference-line removal

- Remove the Waveform center-line stroke but retain the exact center used by positive/negative
  waveform fills.
- Delete `src/lib/deviceHairline.js` and `src/lib/deviceHairline.test.js` once the final consumer
  search confirms Waveform and Stereo Map were the only production users.
- Remove obsolete imports, color reads, redraw-signature fields, and tests that assert those two
  reference lines.

### Tests

- Extend `StereoMapPanel.test.jsx` for active-mode lookup and retained independent mode values.
- Extend `StereoMapPlot.test.jsx` for X/Y fractions, boundary exclusion, one-CSS-pixel DPR scaling,
  Off/no-data behavior, zero only as an enabled Correlation tick, redraw invalidation, and Grid
  before measurement data.
- Update `WaveformPanel.test.jsx` to assert no center stroke while fill geometry remains unchanged.

## Task 5 — Unify the Spectrogram 3D floor without changing its renderer behavior

### Canvas and WebGL

- Remove `gridSubtle` from `selectSpectrogramCanvasColors`, `useSpectrogram3dCanvas`, and every
  frame/uniform contract.
- Lines mode draws frame and subdivisions with the one `grid` color and its existing one-CSS-pixel
  Canvas width.
- Surface mode sends one `gridColour` to the WebGL renderer and uses it for both extruded floor
  batches. Preserve the current line quad width, depth behavior, draw order, and premultiplied
  alpha path.
- Keep `spectrogram3dFloor` as the single control for floor lines and their attached scene labels
  in both 3D modes. Heatmap still exposes and draws neither.

### Tests

- Update the Canvas and GL renderer tests to remove the subtle-color contract and prove both floor
  batches receive the same resolved color.
- Extend `SpectrogramPanel.test.jsx` for default Off, shared Lines/Surface state, label coupling,
  Heatmap omission, and explicit On rendering.
- Retain the current CSS-pixel density and Surface compositing regression coverage unchanged.

## Task 6 — Finish Settings UI and Dock boundaries

- Place the Workspace `Grid` switch as approved: Loudness after Layers, Spectrum after display
  choices, Stereo Map immediately after Mode, and the existing Spectrogram row in its current 3D
  group. Reuse the shared tooltip.
- The Stereo Map row reads and writes only the active mode key; switching modes restores that
  mode's retained value.
- Confirm `DockModuleSettings` and Dock control descriptors do not surface any of the new Grid
  controls. Do not add hidden Dock rendering branches.
- Update `PanelSettingsContent.test.jsx` for row presence, ordering, visibility, labels, tooltip,
  mode retention, and Heatmap/unsupported-panel absence. Update Dock settings tests to pin the
  deliberate omission.

## Task 7 — Synchronize Agent Control

- Update `src/agentControl/panelControls.js`, `panelControlSchema.js`, and
  `panelControlPatch.js` so:
  - Loudness and Spectrum expose one `grid` boolean;
  - Spectrogram retains `controls.threeD.grid`;
  - Stereo Map exposes all four retained mode values, not only the active one.
- Update read, describe, patch, reset, strict-key validation, coverage, bridge, and command contract
  tests together. A reset returns every supported Grid value to Off.
- Regenerate the owned Agent Control pages with `npm run docs:agent-control`; never hand-edit
  `docs/agent-control/generated/`.
- Verify mutations still pass through the existing panel-control business path and revision guard.

## Task 8 — Update living documentation and renderer architecture

- Update `docs/user/panels.md` with which Workspace panels offer Grid, their default-Off behavior,
  Stereo Map per-mode memory, Spectrogram's shared 3D control, and Dock's compact exception.
- Update `docs/user/system-settings.md` for the renamed Vectorscope Guides role and removed Theme
  roles where the Advanced role surface is described.
- Update `docs/design-tokens.md` to remove `data.gridSubtle`, describe the Panel Surface + Border
  derivation, and classify Vectorscope Guides separately from Grid.
- Update `docs/architecture.md` to remove the Waveform/Stereo Map `deviceHairline` exception and
  record the shared normalized-tick contract plus SVG/Canvas/WebGL one-CSS-pixel implementations.
- Update documentation structure checks only where they can derive current facts from code; do not
  add sentence snapshots.

## Task 9 — Verification and visual acceptance

Run focused suites after each task, then run the full merge gate:

```powershell
npm run check
```

Before/after visual evidence must use the running desktop app and Agent Control, following the
renderer-change rule in `docs/pitfalls.md`. Capture deterministic screenshots for:

- Dark and Light Themes;
- Loudness Grid Off/On, including an overlapping Profile Reference;
- Spectrum Off/On in Combined and one dual-trace view;
- all four Stereo Map modes with their retained state switched between modes;
- Spectrogram Heatmap plus Lines and Surface Off/On;
- Vectorscope Lissajous and Polar Guides;
- Waveform and Stereo Map with the retired unconditional reference lines absent;
- normal and constrained panel sizes at 100%, 125%, and 150% Windows display scale where the test
  machine supports them.

Use fixed-pixel comparisons for one-CSS-pixel weight. Specifically verify that no SVG line vanishes,
Canvas Grid follows DPR/backing-store resize, and Spectrogram Lines/Surface floor weight and color
match. Review the shared 8% mix once across this matrix; if it changes, change only the shared
recipe percentage and rerun the Theme/compiler plus screenshot checks.

## Completion criteria

- Default Workspace and every migrated Workspace/Preset open with Grid Off.
- Enabling Grid emits only major-axis projections and never changes analysis/history identity.
- Axis labels and Grid lines share the same normalized tick values and positions.
- Vectorscope Guides remain visible; Waveform and unconditional Stereo Map zero lines are gone.
- Dock exposes no optional Grid.
- Theme V2 semantic migration preserves Vectorscope color intent and removes retired overrides.
- Agent Control and user documentation describe the shipped surface.
- `npm run check` and the deterministic visual matrix pass.
