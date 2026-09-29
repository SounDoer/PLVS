# Border simplification and interaction colour cleanup

## Scope

Implement the reviewed first panel experiment: remove permanent panel outlines and title
underlines while keeping panel surfaces, radii, split dividers, and location/drag highlights.
The ordinary application header/footer, floating surfaces, input affordances, and Dock dividers
retain their geometry. No new Theme Editor controls are added.

Ordinary Border becomes opaque and Input shares it. Automatic Grid no longer depends on Border.
Semantics 3 makes that change explicit; older authored Border colours are composited onto their
Panel Surface and inherited Grid colours are retained by migration. Preservation is relative to
Panel Surface, not every background that previously composited the same alpha colour. Existing
Grid overrides and references remain intact. New portable exports use semantics 3.

Transparent-base controls now share an opaque neutral Hover colour. Filled controls use their
existing opaque Hover recipes. Live/Snapshot surface, border, active, and Hover mixes move to
the central stylesheet, with their previous strengths unchanged. Disabled opacity, shadow alpha,
modal scrims, timeline hints, and Primary Text ownership are unchanged.

## Visual evidence

Local artifacts (not committed) are under `artifacts/border-simplification/`:

- `before/` and `after/`: Windows Agent Control Product Gallery captures using the deterministic
  stereo File fixture, both built-in schemes. The runner restores source, sessions, selection,
  controls, and axes after each pass.
- `pixel-comparison.json`: both workspace captures remain 2388 x 1181. At (1, 150), the old left
  panel outline changes from Dark RGB 42/42/42 to panel RGB 21/21/21, and from Light RGB
  220/216/214 to panel RGB 245/241/238. The title underline at (30, 58) changes identically; the
  adjacent interior at (3, 150) stays unchanged. Removing borders intentionally gives the panel
  content additional space; these captures do not assert pixel identity for time-dependent data.
- `focused/`: both schemes with Compact Panels at 100% and 40% Surface Opacity. These are stopped
  Live captures to inspect boundaries, not data-rendering qualification. Original view and theme
  selection were restored. Panel separation remains visible through the retained split dividers.

The built-in compiler snapshot diff contains only `--border` and `--input`; all chart colours,
Grid/Guides, and shadow values remain unchanged. Tests cover legacy migration through persistence
normalization and portable import, idempotence, explicit Grid overrides/references, Border/Grid
independence, and shared control borders.

## Validation

`npm run check` passed: 421 frontend test files / 4,845 tests, production build, Rust formatting,
Clippy, and Rust workspace tests. The final log is `check-verified.log`. An earlier Rust attempt
could not replace the running development executable; the test window was closed before the
successful complete rerun. The gallery label cleanup also passed its eight targeted tests.
`git diff --check` passed. No development GUI was left running.

## Limits

Visual review covers the local Windows display configuration and the captured layouts. It does
not qualify every custom theme, OS/display scale, or native menu. Drag/location highlight code
and existing interaction tests remain intact; the native gallery does not simulate pointer drags.
No audio-engine code changed.
