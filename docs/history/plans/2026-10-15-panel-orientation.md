# Four-direction panel orientation implementation plan

Date: 2026-10-15
Status: User-tested and approved for merge; validation recorded below.
Design: [Four-direction panel orientation](../specs/2026-10-15-panel-orientation-design.md).
Worktree: `.codex/worktrees/panel-orientation`, branch `codex/panel-orientation`.
Baseline: local `main` at `8a50e0c2`; the inherited Dock commits were already applied on main and
were skipped by rebase. Remote `origin/main` was behind local main when fetched.

## Validation record

- Implemented shared direction geometry, history interaction, all four renderers, independent Dock
  controls, persistence, Agent Control contracts, and matching living documentation.
- Format, lint, typecheck, frontend build, and the full Vitest suite passed. Direction tests cover
  geometry, pointer interaction, waveform strokes, spectrogram repainting, and control contracts.
- Agent Control screenshots cover the original renderer baseline, all four directions with a
  deterministic stereo file, aligned selection markers, and the native Dock layout. Captures and
  benchmark output are retained locally under `artifacts/orientation/` (ignored).
- Confirmed orientation persistence after a full app restart and inspected the isolated workspace
  state file. Confirmed Heatmap orientation survives 3D mode without changing its camera.
- Existing waveform and spectrogram CPU benchmarks were compared before/after. These do not
  measure GPU upload cost or constitute exhaustive vertical-mode frame-performance coverage.
- Visual verification used Windows. Dock screenshots used live mode without an active audio
  fixture; macOS and an exhaustive DPI/axes/mode matrix remain unverified.

### User-testing follow-up

- Changed history orientation to mean content motion, with new data at the opposite edge.
  The default is now Right to Left, preserving the original newest-at-right display.
- Moved Level Meter readouts to the high-level edge in reversed layouts and centered vertical
  Waveform channel labels beneath their lanes. Agent Control captures
  `feedback-vertical.png` and `feedback-horizontal.png` verify both fixes on Windows.
- Added aging-sample geometry coverage and updated interaction, canvas, and control expectations
  for the corrected direction semantics.

## 1. Establish a reproducible baseline

- Read applicable AGENTS.md, architecture screen-space sizing, relevant pitfalls, and the Agent
  Control synchronization contract before implementation.
- Install locked dependencies with `npm ci`. Fetch verified sidecars using `npm run ffmpeg:fetch`
  before Rust/dev-app builds; do not copy them from a sibling worktree.
- Start this worktree's dev app with its supported wrapper. Discover capabilities, inspect state,
  and use expected revisions for changes. Capture baseline screenshots through Agent Control for
  Level Meter modes and each time plot, in ordinary and Dock layouts, with axes on/off.
- Retain controlled input, viewport, dimensions, and scale information with the captures. Record
  representative rendering timings using existing history/waveform/spectrogram benchmark tooling.

## 2. Add direction geometry and adapt history interaction

- Add a pure four-direction module under `src/math/`, with canonical values, forward/inverse
  normalized mappings, time-axis extent, and oldest/newest edge helpers. Keep UI labels in the
  appropriate shared control definition rather than importing React into math.
- Cover endpoints, intermediate points, inverse round trips, non-square rectangles, reverse signs,
  and zero-size handling with adjacent unit tests.
- Refactor `src/hooks/useHistoryInteraction.js` and relevant hover math to accept the logical-time
  mapping without changing existing default behavior. Inspect provider call sites before selecting
  the adapter signature; direction must come from the interacting panel, not shared global state.
- Adapt axis interaction, selection line geometry, `AxisRail.jsx`, and timeline edge hints. Preserve
  pointer capture, modifier meanings, anchored zoom, linked viewport behavior, and gesture cleanup.
- Keep Spectrogram's 3D unprojection behavior covered; do not reinterpret 3D camera coordinates as
  one of the four 2D directions.
- Verify selection and pan/zoom outcomes by timestamp and viewport values, not just event dispatch.

## 3. Implement each renderer using the shared mapping

### Loudness

- Update `LoudnessPanel.jsx`, `LoudnessHistoryChart.jsx`, and `historyMath` call sites for time-axis
  extent and direction-aware paths, rails, reference lines, grids, selection, and hover.
- Retain decimation extrema and all enabled loudness layers. Changing orientation must not reset
  the selected sample, range, or retained history.

### Waveform

- Update `WaveformPanel.jsx` bucket sizing, canvas geometry, and overlays. The effective bucket
  count follows the time dimension, including the existing time-axis pixel-density cap.
- Preserve min/max transients, frequency coloring, centroid, selected-history styling, subpixel
  phase, and CSS stroke widths at different display scales.
- Use non-square fixtures to detect accidental width-based sizing in vertical layouts.

### Spectrogram Heatmap

- Update `SpectrogramPanel.jsx` and `useSpectrogramCanvas.js` for direction-aware raster placement,
  incremental scrolling, newly exposed strips, frequency markers, rails, and hover.
- Include orientation and backing dimensions in presentation-cache invalidation. Compare incremental
  updates against a complete render for all four directions, including timestamp gaps and resize.
- Verify Lines/Surface keep their camera and interactions, and returning to Heatmap restores its
  stored direction. Ensure only the applicable renderer remains active.

### Level Meter

- Update `LevelMeterPanel.jsx` to use four growth directions, including threshold bands, peak/hold
  markers, scales, and all modes. Keep channel ordering and readouts stable within each axis layout.
- Replace old enum expectations directly; add no compatibility aliases or migration.

## 4. Integrate controls, settings, and saved state

- Extend `src/lib/panelControls.js` and `src/workspace/types.js` with shared option definitions and
  per-module controls: retain `levelMeterOrientation`; add `loudnessOrientation`,
  `waveformOrientation`, and `spectrogramOrientation`.
- Default Level Meter to `bottom-to-top`, others to `right-to-left`. Use ordinary default handling
  for missing/invalid stored values, with no legacy orientation translation.
- Keep Level Meter's row after Bar Colors. Insert Orientation immediately before Loudness Range,
  Frequency Range, or Time Range respectively. Add the agreed label tooltip through existing
  SettingsWidgets support; no persistent explanatory row.
- Hide Spectrogram's setting in Lines/Surface without deleting its value.
- Extend `src/dock/dockModuleControls.js` allowed fields and settings rendering as needed; ordinary
  and Dock settings must offer the same semantics and placement.
- Verify normalization, independent instances, settings updates preserving unrelated controls,
  scene/preset restoration, and switching between Dock and normal presentation through existing
  ownership rules. Validate persistence by restarting the dev app and inspecting its settings file,
  never through a Vite reload alone.

## 5. Synchronize Agent Control and living documentation

- Update `panelControlSchema.js`, `panelControls.js`, `panelControlPatch.js`, Dock mappings,
  snapshots, and relevant capability declarations. Expose a module-scoped `orientation` with the
  shared four-value enum and accurate defaults. Explain Heatmap-only effects in the description.
- Verify read/describe/patch/reset coverage, valid and invalid values, dry runs, stale revisions,
  unrelated-setting preservation, and saved Heatmap direction while 3D is active.
- Follow `docs/agent-control/README.md`; regenerate the public reference with
  `npm run docs:agent-control`, never hand-edit generated files.
- Update `docs/user/panels.md` and any affected interaction guidance in the same implementation
  commit. Update living architecture for the durable mapping boundary if needed; living documents
  must not link to this plan/spec. Extend structural checks for code-owned facts, not prose wording.

## 6. Verify behavior, pixels, and performance

- Run focused adjacent tests after each meaningful change. Include mixed orientations on linked
  time viewports, reversed value interactions, selected timestamps, empty/paused/file history,
  direction changes during a gesture, axes on/off, and Spectrogram 3D regression coverage.
- Capture after screenshots through Agent Control with the baseline setup. Review four directions,
  tall/narrow and wide/short plots, ordinary/Dock layouts, all Level Meter modes, marker alignment,
  text placement, clipping, stroke weights, and scaled-display rendering.
- Repeat representative rendering measurements, comparing equal time-axis lengths. Confirm vertical
  sampling scales with height and incremental Spectrogram updates match full renders. Investigate
  material regressions before calling the implementation complete.
- Before each implementation commit: `npm test`, `npm run format:check`, `npm run lint`, and
  `npm run typecheck`. Add `npm run rust:check` if Rust is touched. Before any push or merge, run
  `npm run check:changes`; this mixed frontend scope requires the full gate.
- No capture/DSP change is planned. If scope reaches those layers, follow the capture smoke and
  soak requirements in AGENTS.md instead of treating frontend verification as sufficient.

## Completion evidence

Deliver the implemented controls/rendering, updated user/Agent Control documentation, test results,
before/after visual evidence, and representative performance comparisons. Record remaining limits
honestly. Do not publish a build or website as part of this implementation unless separately asked.
