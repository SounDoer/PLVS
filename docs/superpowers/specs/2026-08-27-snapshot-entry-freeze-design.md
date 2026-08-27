# Bounded-Cost Snapshot Entry Design

**Status:** Implemented on `main` (2026-08-27); real four-hour validation pending.

## Context

PLVS keeps four hours of main history at approximately 10 Hz. After the packed per-panel history
work, Spectrum, Vectorscope, Stereo Map, and visual Waveform snapshots share sealed typed chunks
and copy only their active tails. Entering Snapshot still synchronously materializes several main
history rings and freezes two display indexes on the WebView main thread.

At four hours, the main timeline contains about 144,000 rows. `useSnapshot` currently calls
`toArray()` for:

- loudness rows;
- per-tick audio snapshots;
- per-tick correlation values; and
- per-tick channel metadata.

The same entry also freezes `LoudnessHistoryIndex` and `WaveformHistoryIndex`.
`PowerOfTwoMinMaxIndex.freeze()` copies every retained summary bucket at every level, while
`WaveformHistoryIndex.freeze()` additionally copies its raw-row and NaN-sequence rings. The normal
four-hour path can therefore copy roughly one million references, spread across several new arrays,
before React can paint the selected snapshot.

Each copied value is small. The problem is that the total work and temporary allocation grow with
the entire retained duration and happen in one synchronous interaction.

## Goal

Make Snapshot entry cost bounded by storage chunk size and index level count, rather than by the
number of retained main-history rows, while preserving every existing history row, timestamp,
value, query result, and Snapshot interaction.

In user terms, entering Snapshot should take a small snapshot of the current storage structure; it
must not photocopy four hours of history.

## Non-goals

- Reducing the four-hour retention window.
- Reducing the 10 Hz main-history cadence.
- Quantizing or otherwise reducing scalar numeric precision.
- Changing the already-packed visual history formats.
- Changing Rust DSP, capture, IPC payloads, or file-analysis cadence.
- General React scheduling or live Canvas/SVG redraw optimization.
- Moving history to disk, Rust, a Worker, or another process.
- Changing Snapshot selection, clamping, hover, or missing-data semantics.

## Existing behavior that must remain true

1. Entering Snapshot freezes one coherent point in the live session.
2. Scrubbing inside that Snapshot session reads the frozen data even while live capture continues.
3. Leaving Snapshot immediately returns every consumer to the live source.
4. A later Snapshot session sees the newer live history and does not reuse the earlier boundary.
5. Timestamp lookup remains authoritative when timestamps exist; index-grid fallback remains
   available for timestamp-less test and compatibility data.
6. Clear, capacity changes, capture-session timestamp rebasing, and ring wrap do not mutate an
   already-frozen Snapshot.
7. Loudness and Waveform min/max queries return exactly the same values and retain their current
   sublinear query behavior.
8. Channel metadata at a selected row remains the metadata active at that row.

## Why a frozen pointer into the current RingBuffer is unsafe

The current `RingBuffer` overwrites old array slots when it wraps. A frozen object containing only
`head` and `size` would still point at those slots, so live capture would eventually change rows
visible to the Snapshot. Copying the circular array avoids that bug but creates the present linear
entry cost.

The storage must therefore distinguish immutable sealed data from the small mutable tail.

## Design overview

Main history moves to fixed-size chunks with monotonically increasing sequence numbers, following
the model already proven by visual history:

```text
sealed chunk 41 -> sealed chunk 42 -> sealed chunk 43 -> active tail 44
       shared            shared            shared          copied on freeze
```

Full chunks are sealed and never mutated. A Snapshot shares them. Only the partially filled active
tail is copied. Live capture continues writing to its own tail, so the frozen view cannot change.
Rows are addressed by sequence number; evicting an old chunk changes the retained start, not the
identity of surviving rows.

The same persistent-chunk rule is applied to the min/max index levels and the Waveform index's
supporting sequences. This is necessary: optimizing only the four visible `toArray()` calls would
leave index freezing proportional to four-hour history length.

## Scalar history store

Create a metric-specific `ScalarHistoryStore` rather than changing the general-purpose
`RingBuffer`. A global RingBuffer rewrite would affect unrelated session, persistence, and UI code
without helping this bounded task.

One append represents one main-history tick and writes aligned columns into the same chunk:

- `loudnessRows`: the existing full-precision `{ m, st, waveformMin, waveformMax,
waveformSubPairs, waveformSubCount, timestampMs }` row;
- `audioRows`: the existing result of `buildAudioSnap`;
- `correlations`: the existing full-precision correlation value; and
- the chunk's sequence and row count metadata.

The store exposes stable projected views for loudness, audio, and correlation. Each view supports
the small history protocol already used throughout PLVS:

- `length`;
- `version`;
- `at(index)` and `rowAt(index)`;
- `timestampAt(index)` where relevant; and
- iteration only where an existing consumer requires it.

Array consumers remain supported by the pure helper fallback paths, but production Snapshot must
not call `toArray()` on these views.

The store owns one capacity and one sequence boundary for all three dense domains. This prevents a
Snapshot from accidentally freezing loudness at one row and audio/correlation at another row.

### Row ownership

Objects and typed arrays accepted by the store are immutable after append. `FrameIntake` already
creates the retained loudness and audio snapshots rather than storing the mutable IPC row itself.
The new store preserves that rule. Sealing a chunk does not retroactively freeze every nested
object; correctness comes from ownership and the absence of later mutation.

## Channel metadata as a change timeline

Channel labels usually remain unchanged for long periods. Storing a new metadata object on every
10 Hz tick wastes memory and makes Snapshot freeze do work unrelated to actual changes.

Create `ChannelMetadataHistory`, addressed on the same scalar sequence timeline:

- append a change record only when `frequencyLabel` or `vectorscopePairLabel` changes;
- track the retained scalar start and end sequence even on ticks without a change;
- resolve `rowAt(logicalIndex)` by finding the latest change at or before the target sequence;
- retain the predecessor state needed to answer the first retained row after eviction; and
- freeze its chunked change sequence at the same scalar boundary.

This is lossless run-length encoding. Every historical tick resolves to exactly the same metadata
as the current dense ring, but repeated objects are not stored.

## Chunked immutable sequences

Introduce a small internal `ChunkedSequence` abstraction for immutable object references or scalar
values where a metric-specific typed slab is unnecessary. It provides:

- append with monotonically increasing sequence;
- capacity-based front eviction;
- indexed lookup without flattening;
- sealed immutable chunks;
- a frozen view that shares sealed chunks and copies only the used active-tail prefix;
- clear without reusing sequence identities visible to an older frozen view; and
- structural storage statistics.

The scalar store may use this helper internally, as may index levels, sparse metadata changes,
frequency markers, and Waveform supporting sequences. Public consumers receive metric views, not a
generic storage object.

Chunk size starts at 1,024 rows to match the existing visual-history chunk size. The implementation
benchmark may select a separate scalar constant if measurement shows a clear latency or memory
benefit. Any change must keep the structural bound and be documented next to the constant.

## Persistent min/max indexes

`PowerOfTwoMinMaxIndex` stores immutable bucket objects, but currently holds each level in a
circular `RingBuffer`; freezing flattens every level. Replace those level rings with chunked
sequences.

A frozen index records:

- retained start and end sequence;
- value count and version;
- a frozen view for each completed-bucket level; and
- the small pending-bucket frontier required by the existing query semantics, if needed.

Each level shares sealed chunks and copies at most its active tail. The number of levels is
`O(log capacity)`, so entry work is bounded by approximately:

```text
index level count x chunk rows
```

rather than by the total number of retained summary buckets. Query algorithms, bucket widths,
min/max precision, and fallback raw-row reads remain unchanged.

Both `LoudnessHistoryIndex.freeze()` and `WaveformHistoryIndex.freeze()` use this persistent index
freeze. `WaveformHistoryIndex` also migrates its internal raw rows and NaN sequences away from
flattening RingBuffers so no hidden full-history copy remains.

## Sparse frequency markers

`SparseHistoryMarkers.freeze()` currently copies retained marker entries. Marker counts are usually
small, but a valid worst case may contain one marker per history row. Migrate its marker sequence to
the same chunked immutable storage so the Snapshot contract is bounded for every input, not only
the usual one.

The legacy dense `_frequencyChannelMarkers` ring is not part of `useSnapshot`. Its production
callers must be audited during implementation. If none exist, remove it and retain its behavior
through the sparse marker API; otherwise migrate it without broadening this design.

## Atomic FrameIntake freeze

Add one `FrameIntake` method that freezes the complete main-history Snapshot bundle in a single
synchronous operation, for example:

```js
intake.snapshotScalarHistory();
```

It returns:

- frozen loudness, audio, and correlation views from one scalar-store boundary;
- the frozen channel-metadata view at that boundary;
- frozen Loudness and Waveform indexes;
- the frozen sparse frequency-marker index; and
- storage/copy statistics in developer builds or through an explicit diagnostic method.

`useSnapshot.freezeSnapshot` consumes this bundle instead of independently calling `toArray()` and
index freeze methods. The already-packed visual families continue to freeze through their existing
APIs in the same Snapshot session.

The operation is synchronous, so frame ingestion cannot interleave inside it in the browser event
loop. A shared boundary still makes alignment explicit and testable rather than relying on call
order.

## Snapshot read path

`resolveSnapshot`, timestamp lookup, hover math, Loudness, Waveform, and Spectrogram already support
indexed history-like views in most paths. Production code standardizes on the protocol above.

No Snapshot consumer may require:

- `Array.isArray(view)` to be true;
- numeric bracket access for a production history view; or
- `Array.from`, spread, `slice`, or `toArray()` over the full retained source.

Pure helpers may keep Array compatibility for tests and non-production callers. One selected row or
one pixel-bounded visible window may still be materialized when that is the actual rendering input.

## Complexity and allocation budget

Let:

- `N` be retained scalar rows (about 144,000 at four hours);
- `C` be scalar chunk rows (initially 1,024); and
- `L` be min/max index levels (about 17 at four hours).

Current Snapshot entry performs `O(N)` dense and index reference copying.

The target entry performs:

- `O(C)` work for the aligned scalar active tail;
- `O(C x L)` worst-case reference work across each persistent index's active level tails;
- `O(C)` per sparse supporting sequence; and
- `O(number of chunks + L)` lightweight descriptor collection.

Descriptor collection must not copy row payloads. If iterating all chunk descriptors is measurable,
the store may keep a persistent descriptor spine, but this is not required before measurement.

No new retained row objects, audio objects, waveform arrays, or summary bucket objects are created
on Snapshot entry. Only tail containers and small frozen-view descriptors are allocated.

## Benchmark and diagnostics

Extend the history performance benchmark with a scalar Snapshot-entry scenario at representative
short and four-hour capacities. Report:

- retained scalar rows;
- freeze wall time, as a diagnostic rather than a brittle CI threshold;
- shared sealed chunks;
- copied tail rows and references per dense column;
- index levels, shared chunks, and copied active-tail references;
- channel metadata change count;
- sparse marker count;
- total copied references and copied payload bytes where meaningful; and
- result checksums before and after live wrap to prevent a benchmark-only shortcut.

Automated tests assert structural work bounds, not machine-specific milliseconds. The four-hour
report must demonstrate that doubling retained rows without changing chunk size does not double
copied payload or reference counts.

## Failure and lifecycle behavior

- If history is empty, freezing returns empty views with valid zero statistics.
- Capacity changes rebuild live scalar history exactly as today; existing frozen views remain valid.
- Clear starts live storage on a non-conflicting sequence boundary; existing frozen views remain
  readable.
- Repeated entry/exit creates independent Snapshot descriptors. Once React releases a Snapshot
  source, no cache or live store retains it.
- A partial front chunk caused by retention wrap is shared safely because sealed chunks are
  immutable; the frozen view records its own start sequence.
- Non-finite loudness, correlation, waveform, and audio sentinel values retain their current
  semantics.

## Testing

### Storage behavior

- Append, indexed access, iteration compatibility, wrap, partial-front-chunk lookup, and clear.
- Freeze shares sealed chunks and copies only an active tail.
- Appending through and beyond live wrap does not change a frozen row.
- Two freezes at different boundaries remain independent.
- Aligned loudness, audio, and correlation projections always have equal length and matching row
  positions.

### Metadata behavior

- Repeated identical metadata creates one change record.
- A change resolves from its exact row until the next change.
- Eviction retains the predecessor state required at the new oldest row.
- Freeze, later changes, wrap, clear, and capacity rebuild do not mutate old results.

### Index behavior

- Persistent frozen index queries match the current full-copy implementation for randomized
  ranges.
- Partial front ranges, pending buckets, NaN Waveform rows, and multi-channel value counts match.
- Freeze work remains bounded by chunk tails and level count at four-hour capacity.

### Hook and integration behavior

- `useSnapshot` freezes the scalar bundle once per Snapshot session.
- Audio, correlation, channel metadata, Loudness, Waveform, and frequency markers remain frozen
  while live rows arrive.
- Scrubbing does not refreeze or flatten history.
- Exiting returns the stable live views; entering again takes a new boundary.
- Existing Array-based pure tests remain supported.

## Acceptance criteria

- No production Snapshot-entry path calls `toArray()`, `Array.from`, spread, or full-range `slice`
  on main history or its indexes.
- Four-hour Snapshot entry copies no complete dense history column and creates no per-retained-row
  object.
- Frozen views remain bit-for-bit equivalent to current scalar values and query results.
- Retention, cadence, timestamps, precision, channel alignment, and UI behavior are unchanged.
- Snapshot entry structural copy counts are bounded by chunk tails and index level count, not `N`.
- The benchmark exposes enough accounting to catch an accidental return to linear copying.
- Focused tests and `npm run check` pass.
- A real four-hour soak confirms that Snapshot entry is responsive after retention fills.

## Implementation boundaries

- Keep the work in JavaScript/React; do not touch `src-tauri/src/audio`, `dsp`, or `engine`.
- Do not generalize the new storage into unrelated domains during this pass.
- Do not combine this work with live-panel redraw throttling. Snapshot entry and steady-state CPU
  need separate measurements and rollback points.
- Land on `main`, following the repository's default workflow.
