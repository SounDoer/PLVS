# Vectorscope hold slow mode — design

Date: 2026-07-10
Status: Revision 3 — approved (persistence window rendering)

> Revision history:
> - Rev 1 (approved): display refresh throttle (200 ms cadence + crossfade). User testing:
>   read as frame-skipping jumps, not a smooth slowdown.
> - Rev 2 (shipped in `8df3d52`): spectrum-style per-point EMA + size renormalization. User
>   testing: smooth, but the point-to-point structure is fabricated (per-point EMA of
>   index-shuffled targets), so it conveys only lagged cloud statistics — poor reflection of
>   the current signal.
> - Rev 3 (this design): phosphor-persistence window rendering — draw the real samples from
>   the recent history window with age-based fading. Replaces the Rev 2 trace smoothing.

## Background

Holding the left mouse button on the Vectorscope plot should turn the flickering per-frame
Lissajous trace into a stable, readable view of the current stereo image — the equivalent of
an analog scope's phosphor afterglow. Every displayed point must be a real measured sample;
stability comes from showing a statistically stable window of recent data, not from fabricating
interpolated shapes.

## Scope

Frontend-only. No Rust/IPC changes; frame intake and history writes are untouched (read-only
use of an existing accessor).

Files:

- `src/components/panels/VectorscopePanel.jsx` — gesture (existing), persistence canvas layer,
  removal of the Rev 2 EMA trace smoothing.
- `src/math/vectorscopePersistence.js` (new) — pure window-selection / extent / alpha math.
- `src/App.jsx` — expose `getVectorscopeHistoryForKey` on the history data context.

Out of scope: engine-side true slow motion; density/heatmap accumulation; any persisted
setting; other panels' hold gestures.

## Gesture (unchanged from Rev 1)

- Left button, 300 ms hold, ≤ 4 px movement (`HOLD_SLOW_DELAY_MS`, `HOLD_SLOW_CANCEL_PX`).
- Guards: not in snapshot mode, not when `historyChartInteractive` is false, not with ctrl.
- Exit on pointer up/cancel/leave; cleanup on unmount.

## Slow-mode behavior (Rev 3)

While held (live mode only):

- **Persistence layer**: a `<canvas>` absolutely positioned over the trace SVG's box replaces
  the live trace path (the SVG `<path>` is not rendered while the layer is active). Every
  render while active, the canvas is fully redrawn from the panel's request-key history slab
  (`VectorscopeHistorySlab`, 40 ms cadence, raw interleaved L/R pairs per row):
  - **Window**: rows whose `timestampMs` is within `1500 ms` of the newest row's timestamp
    (age is measured against the newest row, not the wall clock, to stay clock-domain safe).
    ≈ 38 rows × ~200 pairs ≈ 7500 real sample points.
  - **Form**: each row's pairs are drawn as a connected polyline (rows are sample-clocked and
    contiguous, so this is the true signal trajectory), stroked with the live trace color
    (`--ui-vectorscope-trace` resolved via `getComputedStyle`) at the existing
    adaptive stroke width.
  - **Fade**: per-row `globalAlpha` from age: newest ≈ 0.9 down to ≈ 0.05 at the window edge
    (linear in age).
  - **Extent**: one effective radius computed over *all* pairs in the window (same
    Chebyshev-extent auto-zoom as `buildVectorscopeSvgFromPairs`), so the whole window shares
    one scale and the display does not pump frame-to-frame.
- **Correlation marker**: keeps the Rev 2 behavior — the correlation value is low-passed with
  `HOLD_SLOW_SMOOTHING_ALPHA = 0.06` before the existing live display smoothing.
- **Fallback**: if the history accessor is unavailable, the slab is missing, or fewer than 2
  rows fall in the window, the plain live trace path renders as if not held.

On release, the canvas layer unmounts and the live SVG path resumes immediately.

The Rev 2 trace machinery (path parse/rebuild, per-point EMA, size renormalization) is removed.

## Data flow

`FrameIntake.getVisualVectorscopeHistByKey(key)` already exists (used by snapshot freezing).
`App.jsx` adds `getVectorscopeHistoryForKey: (key) => intakeRef.current.getVisualVectorscopeHistByKey(key)`
to the `historyData` context object. The panel calls it only while the hold is active.
Slab rows are read via `rowAt(i)` subarray views — no copies, no writes.

## Pure math (`src/math/vectorscopePersistence.js`)

- `selectPersistenceWindow(slab, windowMs)` → `{ rows: [{ pairs, ageMs }...] }` oldest-first,
  ages relative to the newest row's timestamp; empty result for null/short slabs.
- `computeWindowEffRadius(rows)` → shared effective plot radius (Chebyshev extent over all
  pairs, `VS_EXTENT_FLOOR` floor, same constants as `vectorscopeMath.js`).
- `persistenceAlpha(ageMs, windowMs)` → linear `0.9 → 0.05` over the window.

Canvas drawing itself stays in the panel (thin, unit-untestable in jsdom by design: jsdom's
`canvas.getContext` returns null and the draw effect guards on it).

## Performance

Bounded and hold-only: ~38 polylines / ~7500 `lineTo` per redraw on a 2D canvas, redrawn at
frame cadence only in the held panel instance. Reads are subarray views. No allocations beyond
the row descriptor array per redraw.

## Tests

- Existing gesture/guard tests unchanged (activation, move-cancel, snapshot/interactive
  gating, pointer-up restore) — reworked to assert against the persistence layer instead of
  EMA'd path coordinates.
- `vectorscopePersistence.test.js`: window selection (drops rows older than the window,
  ages relative to newest row), extent (shared radius matches expected for known pairs,
  floor applied), alpha mapping endpoints.
- Panel: canvas layer (`[data-vectorscope-persistence]`) present and live path absent while
  held; live path restored on pointer up; fallback to live path when no accessor / too few
  rows; correlation low-pass retained (existing deterministic test).
