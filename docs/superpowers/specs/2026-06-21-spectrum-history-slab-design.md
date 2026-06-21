# Spectrum History Slab Storage

**Date:** 2026-06-21
**Status:** Draft

## Summary

Reduce WebView2 memory pressure from long-running Spectrum and Spectrogram
views by replacing per-tick JS object/array history with request-keyed typed
array slab storage.

This slice keeps the existing visual history window:

```txt
VISUAL_MAX_SAMPLES = 180_000 // 25 Hz x 2 h
```

It also keeps the per-instance analysis request model and request caps. The
goal is to lower memory use and garbage collection cost without reducing the
amount of retained history or changing user-visible Spectrum/Spectrogram
behavior.

## Motivation

Spectrum-like history is currently the largest frontend memory risk. A heavy
workspace can have multiple Spectrum/Spectrogram panels active at the same time,
and history is retained per unique spectrum-like request key. A half-hour run at
25 Hz already stores roughly 45,000 visual ticks per key; the configured cap is
four times larger.

Current storage keeps each visual tick as a JS object:

```js
{
  bands,
  dbList: Array<number>,
  dbListB: Array<number>,
  timestampMs
}
```

Even though band objects and constant rows are cached, non-constant frequency
rows still allocate many JS arrays and many JS numbers over time. This creates a
large object graph for V8/WebView2 to retain and scan.

The same data shape is naturally rectangular:

```txt
samples x bands
```

That shape is a better fit for contiguous typed arrays than for thousands of
small JS arrays.

## Current Model

`FrameIntake` owns long-lived frontend capture and history state.

Relevant current paths:

- `App.jsx` defines `VISUAL_MAX_SAMPLES = 180_000`.
- `FrameIntake.pushVisualHistRow()` writes shared visual histories and
  request-keyed spectrum histories.
- `_visualSpectrumHistByKey` stores one `RingBuffer` per spectrum-like request
  key.
- each ring entry stores `bands`, `dbList`, optional `dbListB`, and
  `timestampMs`.
- `_spectrogramSnapArrayByKey` caches `ring.toArray()` for live spectrogram
  readers.
- `snapshotVisualSpectrumByKey()` freezes per-key histories into arrays for
  snapshot scrubbing.

The current model is simple and compatible with existing readers, but it pays
for many object allocations:

- one ring entry object per tick;
- one array for `dbList` per tick;
- one array for `dbListB` per tick when a secondary curve exists;
- repeated `ring.toArray()` arrays for live spectrogram readers;
- GC tracking for all of the above.

## Goals

- Keep the existing 2-hour visual history cap.
- Keep request-keyed history semantics.
- Keep Spectrum, Spectrogram, hover HUD, snapshot scrubbing, and no-backfill
  behavior unchanged.
- Avoid duplicating large frequency rows per panel id.
- Reduce retained WebView2 memory for non-constant spectrum history.
- Reduce GC pressure from per-tick JS array/object allocation.
- Preserve the public history entry shape at component boundaries where doing
  so keeps the first implementation low risk.

## Non-Goals

- Changing `VISUAL_MAX_SAMPLES`.
- Reducing frequency band count.
- Downsampling, decimating, or pruning old Spectrogram history.
- Persisting request history across app restarts.
- Reworking Rust DSP output format.
- Changing request caps.
- Changing Stop or Clear product behavior.
- Optimizing Waveform, Vectorscope, Loudness, or Stats history in this slice.

## Data Precision Decision

Two internal storage modes are valid:

| Mode | Bytes per dB value | Numeric behavior | Memory reduction |
|------|--------------------|------------------|------------------|
| `Float64Array` slab | 8 | closest to current JS number semantics | moderate |
| `Float32Array` slab | 4 | display-equivalent for dB curves | larger |

Decision: v1 uses `Float32Array` slab storage for visual spectrum history.

Rationale:

- Spectrum/Spectrogram drawing and hover display do not need 64-bit dB
  precision.
- Existing UI formatting is coarser than Float32 error for dB values.
- The main problem is memory pressure and GC cost; halving stored dB bytes is
  valuable.

If exact 64-bit equivalence is required during a future debugging pass, the
storage class can make the element type configurable so `Float64Array` can be
used as a one-line fallback.

## Target Model

Introduce a request-keyed spectrum history slab.

Conceptually:

```txt
SpectrumHistorySlab {
  capacity: number
  bandCount: number
  head: number
  size: number
  bands: Band[]              // shared object array for this frequency grid
  timestamps: Float64Array   // capacity
  dbA: Float32Array          // capacity * bandCount
  dbB: Float32Array | null   // allocated only when needed
}
```

Rows are written by ring slot:

```txt
slot = (head + size) % capacity
offset = slot * bandCount
dbA[offset ... offset + bandCount] = smoothDb
```

When full, writing advances `head` and overwrites the oldest slot, matching
`RingBuffer` behavior.

### Band Grid Changes

A slab is valid for one frequency grid. If a request key receives a different
band grid than the slab currently owns, recreate the slab for that key.

This is acceptable because band-grid changes correspond to DSP configuration or
device/sample-rate changes. It is safer to clear that key's old visual history
than to mix incompatible rows in one slab.

The existing band object cache remains useful:

```txt
length:first:last -> Band[]
```

### Missing or Invalid Values

When an input row is shorter than `bandCount`, fill missing dB cells with
`-Infinity` or the existing no-data sentinel used by current readers.

When an input row is longer than `bandCount`, truncate to `bandCount`.

`timestampMs` remains a number and is stored in `Float64Array` to preserve time
precision.

### Secondary Curve

`dbB` should be lazy:

- `null` while no secondary curve is present;
- allocated as `Float32Array(capacity * bandCount)` the first time a row with
  `smoothDbB` arrives;
- rows without `smoothDbB` fill the matching slot with `NaN` or another explicit
  no-secondary sentinel.

Using a sentinel is preferable to changing row lengths because readers can test
for finite values without extra object shape churn.

## Reader Compatibility

The first implementation should preserve existing component-facing history
entry shape:

```js
{
  bands,
  dbList,
  dbListB,
  timestampMs
}
```

The difference is that the entries are produced by lightweight views over the
slab instead of being the primary storage.

Recommended APIs:

```js
class SpectrumHistorySlab {
  push({ bands, dbList, dbListB, timestampMs })
  clear()
  toArray()
  get(index)
  get length()
  get capacity()
}
```

`toArray()` returns chronological entries, like `RingBuffer.toArray()`.

For v1, `dbList` and `dbListB` in returned entries may be `Float32Array`
subarrays. Existing rendering code should treat them as read-only array-like
objects. If any consumer requires a plain JS array, adapt only at that consumer
boundary rather than restoring array allocation in the storage layer.

### Live Spectrogram Reads

`SpectrogramPanel` currently reads a stable array from
`getSpectrogramSnapsForKey()`. The new implementation can keep this method but
should avoid rebuilding a full plain array on every push if possible.

Plain-language version: the Spectrogram renderer needs to read old frequency
rows left-to-right as pixels. It can either ask the slab to hand it an
array-shaped view, or it can keep receiving the same chronological array shape
it receives today. The first option is cleaner long term; the second option
touches less rendering code in v1.

Acceptable v1 options:

1. Return `slab.toArray()` and rely on typed row slices for most memory savings.
2. Cache the chronological entry array per key and invalidate it only when that
   key receives a new row.
3. Add a small adapter that exposes `length` and indexed reads without
   materializing all entries, then update `useSpectrogramCanvas()` to consume
   array-like history.

Preferred v1: option 2. It limits component churn while avoiding unnecessary
array rebuilds for keys that did not receive a new row.

## Integration Points

### `src/lib/SpectrumHistorySlab.js`

New pure storage module.

Responsibilities:

- ring semantics over typed arrays;
- band-grid validation and reset;
- optional secondary curve allocation;
- chronological `toArray()` adapter;
- `clear()` releases typed array references;
- focused unit tests for overwrite, grid change, secondary curve, and adapter
  behavior.

### `src/lib/FrameIntake.js`

Replace request-keyed spectrum visual rings:

```txt
_visualSpectrumHistByKey: Map<string, RingBuffer>
```

with:

```txt
_visualSpectrumHistByKey: Map<string, SpectrumHistorySlab>
```

Keep method names stable where practical:

- `getVisualSpectrumHistByKey(key)` returns the per-key slab or `null`.
- `getSpectrogramSnapArrayForKey(key)` returns the cached chronological adapter.
- `snapshotVisualSpectrumByKey()` returns plain object keys with chronological
  histories for snapshot mode.

Capacity changes and `clear()` must release slabs and cached arrays.

### Existing Shared Spectrum History

The older shared `_visualSpectrumHist` can remain a `RingBuffer` in v1 if it is
only needed for compatibility or legacy snapshot paths.

If current code no longer uses it for active Spectrum/Spectrogram rendering, a
later cleanup can remove it. Do not combine that cleanup with the slab storage
change unless tests show it is trivial.

## Memory Expectations

For one request key with 958 bands and 180,000 visual ticks:

```txt
Float64 raw dB storage: 180,000 x 958 x 8  = ~1.38 GB per curve
Float32 raw dB storage: 180,000 x 958 x 4  = ~690 MB per curve
```

The current JS array/object representation stores the same numerical payload
plus significant overhead from arrays, objects, references, and GC metadata.

The slab does not make the 2-hour, 4-request worst case small. It makes the
worst case bounded by a few large typed arrays instead of by many small objects.
This should reduce:

- WebView2 working set;
- V8 heap pressure;
- GC pauses and object graph scan cost;
- fragmentation from long-lived per-tick arrays.

## Clear, Stop, and Lifecycle

Clear must release typed array references, not just reset size counters.

Expected `clear()` behavior:

- per-key slab maps are dropped;
- cached chronological arrays are dropped;
- typed array backing stores become eligible for GC;
- no retained references remain through Spectrogram live adapters.

Stop capture follows existing history retention semantics. This spec does not
change whether Stop keeps or clears history.

Restart does not restore runtime history.

Inactive request-key slabs are retained until Clear in v1. This preserves the
current behavior where switching a Spectrum/Spectrogram panel back to a recent
old request can still show that request's retained history. Earlier eviction can
be a later memory-pressure slice if the slab change is not enough.

## Rollout Plan

1. Add `SpectrumHistorySlab` with unit tests.
2. Switch request-keyed spectrum history in `FrameIntake` to use slabs.
3. Keep public reader methods stable.
4. Run targeted frontend tests:

```txt
npm test -- src/lib/FrameIntake.test.js src/components/panels/SpectrogramPanel.test.jsx src/hooks/useSnapshot.test.jsx
```

5. Run broader check:

```txt
npm run check
```

6. Compare real desktop/WebView2 memory under the same workload that motivated
   this spec:

```txt
3 Level Meter
2 Spectrum
1 Spectrogram
1 Waveform
1 Loudness
1 Vectorscope
1 Stats
30 minutes capture
```

## Success Criteria

- Existing Spectrum and Spectrogram tests pass.
- Snapshot scrubbing still shows correct per-request history.
- Switching Spectrum/Spectrogram chips still starts new history without
  backfill.
- Over-cap request behavior is unchanged.
- Clear releases retained per-key history.
- Desktop memory under the stress layout is materially lower than the current
  near-6GB half-hour observation.
- Memory growth remains roughly linear with active request keys and elapsed
  visual history until the configured cap, then plateaus.

## Testing Notes

- `SpectrumHistorySlab` stores and returns rows in chronological order.
- Overwriting after capacity is full drops the oldest row.
- A band-grid change resets that request key's slab.
- `dbB` allocation is lazy and rows without a secondary curve have an explicit
  no-secondary value.
- Returned `dbList` values are read-only array-like typed views.
- `FrameIntake.clear()` drops slab references and cached spectrogram arrays.
- `snapshotVisualSpectrumByKey()` keeps the shape expected by snapshot
  resolution.
- `getSpectrogramSnapArrayForKey()` returns only the requested key's history.

## Open Questions

- Should live `useSpectrogramCanvas()` consume an array-like adapter directly,
  or should v1 keep returning chronological arrays?
