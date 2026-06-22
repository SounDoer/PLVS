# Spectrogram History Read Performance — Design

Date: 2026-06-22
Status: Approved (pending implementation)

## Problem

Continuous capture longer than ~1 hour produces growing UI stutter: meter heads jerk
and entering snapshot mode hitches. The cause is recent (per-instance / spectrogram
history work, June 8–22) and is confirmed by measurement, not inferred.

Both rings are fixed at a 2-hour cap (`HIST_MAX_SAMPLES = 72000` @ 0.1s,
`VISUAL_MAX_SAMPLES = 180000` @ 0.04s/25 Hz), so during the first two hours the fill
level — and the cost of any "walk the whole history" code — grows linearly with
capture time.

Two hotspots, both in the per-key spectrum history path, both linear in fill:

### Symptom A — ongoing stutter (worsens with capture time)

`FrameIntake.pushVisualHistRow` runs on every 25 Hz visual tick and, for each active
request key, executes:

```js
this._spectrogramSnapArrayByKey.set(key, slab.toArray());
```

`SpectrumHistorySlab.toArray()` materialises the **entire ring** into a fresh JS array
of plain objects, each holding `Float32Array` subarray views, every tick. This runs on
the main thread on the data-intake path, so the resulting allocation + GC churn stutters
**all** meters, not only the spectrogram.

Measured (1/24 resolution, 240 bands, single key; 40 ms = one 25 Hz tick budget):

| Capture | ms per tick | % of 40 ms budget |
| --- | --- | --- |
| 1 min | 0.066 | 0.2% |
| 6 min | 0.281 | 0.7% |
| 60 min | 10.7 | 27% |
| 120 min | 20.9 | 52% |

Cost is per active key — two spectrogram panels double it.

### Symptom B — entering snapshot hitches (one-shot, also grows with capture time)

`FrameIntake.snapshotVisualSpectrumByKey()` deep-copies every row of every retained key
(`toArray({ copyRows: true })` → `Float32Array.from` per row + per-row objects) when
snapshot mode is entered.

Measured (single key): 70 ms at 60 min, 175 ms at 120 min. Two panels roughly double it.

### Out of scope (measured, not a problem)

The vectorscope path was measured for symmetry: live push stays flat (~0.001 ms/tick, no
per-tick rebuild) and `snapshotVisualVectorscopeByKey()` is 0.59 ms at 120 min. It is left
untouched.

## Goals

- Remove the per-tick full-history rebuild so live capture cost no longer grows with fill
  (symptom A).
- Make entering snapshot a bulk typed-array copy instead of per-row object allocation
  (symptom B).
- **No behavioural change.** Live rendering, hover, and snapshot scrubbing produce the
  same output as today; only the cost changes.

## Non-Goals

- No change to ring capacity, sample rates, or the 2-hour window.
- No change to vectorscope storage or snapshot.
- No fully zero-allocation flat-buffer read path in the paint/hover loops (considered as
  "A3"; rejected as over-engineering — see Approaches).

## Approaches Considered

- **A1 — lazy cached array (invalidate on new row).** Rebuild `toArray()` on read behind a
  dirty flag instead of on push. Rejected: during live capture a new row arrives every tick,
  so the cache is dirtied every tick and rebuilt on the next paint every tick. Does not fix
  symptom A.
- **A2 — shared read-only history interface; consumers read by index (chosen).** Live slab
  and frozen snapshot implement one interface; nobody materialises the whole history. Per-tick
  cost drops to zero; repaint cost drops from O(total history) to O(visible window).
- **A3 — fully zero-allocation flat reads.** A2 plus paint/hover reading the slab's flat
  `dbA` typed array via slot arithmetic, avoiding even the per-row view object. Rejected:
  A2 already bounds per-frame allocation to the visible window; A3 complicates the hot loops
  for marginal gain.

## Design

### Read-only history interface

One interface consumed by all spectrum-history readers (live and snapshot):

- `length` — number of frames, chronological.
- `timestampAt(i)` — `timestampMs` of frame `i` (for binary search; reads the typed
  timestamp array, no allocation).
- `rowAt(i)` — `{ bands, dbList, dbListB, timestampMs }` for frame `i`. `dbList` / `dbListB`
  are read-only `Float32Array` views; `bands` is the shared band-grid array. Equivalent to
  the existing `slab.at(i)`.

Two implementations:

1. **Live — `SpectrumHistorySlab`.** Already a chronological ring with `at(i)` and a
   `timestamps` typed array. Add `timestampAt(i)` (slot-resolved) and confirm `rowAt`
   semantics (alias `at`). The slab *is* the live view; `getSpectrogramSnapsForKey(key)`
   returns it directly.
2. **Snapshot — `FrozenSpectrumHistory`.** Produced by `slab.freeze()`, which **bulk-copies**
   the slab's backing typed arrays as of the freeze moment (`timestamps`, `dbA`, and `dbB` +
   `hasB` when present) into a linear, head-normalised layout, plus a reference to the shared
   `bands`. Implements the same `length` / `timestampAt` / `rowAt`. Bulk `slice()` copies are
   O(memcpy) rather than O(rows × bands) object allocation.

**Correctness invariant (the one real risk):** a frozen snapshot must be immune to live
pushes that continue after the freeze. The live slab is a ring that overwrites the oldest
slot once full, so the snapshot cannot hold a live reference. `freeze()` copying the typed
arrays at the freeze instant guarantees stability. This is the property the existing
`FrameIntake.test` "freeze … safely" case guards; it is kept and strengthened.

### `FrameIntake` changes

- Remove `_spectrogramSnapArrayByKey` and the per-tick
  `this._spectrogramSnapArrayByKey.set(key, slab.toArray())` in `pushVisualHistRow`.
- `getSpectrogramSnapsForKey(key)` returns the live slab (the view) or an empty view when no
  slab exists, replacing the cached plain array. `getSpectrogramSnapArrayForKey` is renamed
  to `getSpectrogramSnapsForKey` to reflect that it no longer returns a materialised array
  (App.jsx already wraps it as `getSpectrogramSnapsForKey`).
- `snapshotVisualSpectrumByKey()` returns `{ [key]: slab.freeze() }` (frozen views) instead
  of `{ [key]: slab.toArray({ copyRows: true }) }`.
- `reset()` / capacity change continue to drop per-key slabs; no separate snap-array map to
  clear.

### Consumer changes

All read through the interface (`length` / `timestampAt(i)` / `rowAt(i)`) instead of plain
array indexing:

- `spectrogramTimeline.inWindowRange(view, oldestMs, newestMs)` — binary search via
  `view.timestampAt(mid)` and `view.length`. `spectrogramDataBoundaries` likewise.
- `useSpectrogramCanvas` `paintImageData` — iterate `view.rowAt(i)`; `firstSnap` /
  `bands` read via `view.rowAt(view.length - 1)`.
- `hoverMath.computeSpectrogramHoverPoint` — same index-based reads.
- Snapshot resolution (`snapshotResolve.resolveKeyedVisualIndex` and
  `useSnapshot.resolveSpectrumSnapshotForKey`) — read from the frozen view by index.

The interface is small and explicit, so each consumer can be unit-tested against a simple
fake view without constructing a full slab.

## Testing

- **Microbenchmark as regression baseline** (`bench-spectrogram-snap.mjs`, kept or promoted
  to a guarded perf check): per-tick push at 180k fill is within noise of push at 0 fill (no
  growth), and snapshot at 120 min drops from ~175 ms to single-digit ms.
- **`SpectrumHistorySlab`**: `timestampAt` / `rowAt` correctness over wrap-around;
  `freeze()` content matches the live ring; a frozen view is unchanged by subsequent
  `push()` / overwrite (the isolation invariant).
- **`spectrogramTimeline`**: `inWindowRange` / `spectrogramDataBoundaries` against a fake
  view produce the same ranges/markers as the prior array-based tests.
- **`hoverMath` / `useSpectrogramCanvas`**: read-path tests updated to the view interface;
  output unchanged.
- **`FrameIntake`**: per-tick push no longer allocates a snap array; `snapshotVisualSpectrumByKey`
  returns frozen views; existing "freeze … safely" behaviour preserved.
- **`snapshotResolve` / `useSnapshot`**: keyed resolution against frozen views unchanged.
- Full `npm run check` (format + lint + test + build + version + Rust fmt/clippy/test).

## Rollout

Direct to `main` (per owner). No data migration, no persistence change, no IPC change —
this is an in-memory read-path refactor with identical observable behaviour.
