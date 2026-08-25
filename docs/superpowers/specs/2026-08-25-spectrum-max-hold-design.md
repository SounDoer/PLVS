# Spectrum Max Hold — Design

**Date:** 2026-08-25
**Status:** Approved in product discussion

## Summary

Replace the Spectrum panel's decaying peak envelope with a cumulative Max Hold, matching the kind
of hold the Vectorscope and Stereo Map panels already offer.

Today the held curve is a **decaying** envelope computed in Rust (`dsp/spectrum.rs::apply_envelope`):
a band's peak holds for 1.5 s, then falls at 8 dB/s. It shows "the peak of the last few seconds",
it cannot be reset, and it is absent in snapshot mode.

After this change the held curve is the **maximum since the hold was turned on or last reset**,
computed in the frontend, resettable by clicking the held curve, and reconstructed in snapshot mode
for the selected row.

## Product decisions

### Behaviour

- Max Hold is the per-band maximum of the smoothed curve, since the control was switched on or
  since the last reset. It never decays.
- Turning the control off and on again starts a new hold.
- A change of band grid — different channel selection, different octave smoothing, a new analysis
  key — resets the hold. A held curve from one grid means nothing on another.
- In snapshot mode the held curve is the hold **as it stood at the selected row**, reconstructed
  from the retained history.

### Reset gesture

Clicking the held curve resets it. This follows the Level Meter's existing idiom, which the panel
help already states as `Click marker - Reset TP Max`.

The Spectrum chart's plain left click is **already taken**: it captures a snapshot, and double
click returns to live. The reset therefore cannot live on the chart background the way the
Vectorscope's Polar Level reset does. Three requirements follow:

- The hit target is a dedicated invisible path with `fill="none"`, a widened transparent stroke
  (~10 px) and `pointerEvents="stroke"`. The filled area under the held curve keeps
  `pointerEvents="none"`; making the fill clickable would turn most of the chart into a reset
  button and swallow snapshot clicks.
- The handler stops the click from reaching the chart's snapshot handler, through the existing
  `suppressChartClickRef` mechanism or `stopPropagation`.
- The hit target exists only while Max Hold is on and the panel is live. In snapshot mode the
  curve is reconstructed from history, so there is nothing to reset.

Cursor feedback on hover marks the strip as a control.

**Known risk, accepted:** when the held curve sits over the point the user wants to click, the
~10 px strip takes a click intended for the snapshot capture. If that proves annoying in practice,
the fallbacks are Ctrl-click or a reset button in the panel settings row. Neither is built now.

### Naming

- The settings row label changes from **Max Decay** to **Max Hold**. The persisted key is already
  `spectrumMaxHold` and does not change.
- The Peak Labels tooltip sentence "Max Decay is the time axis; this is the frequency axis"
  changes to name Max Hold.
- The Spectrum help gains a line for the reset gesture.

### Dock

The Dock's Spectrum module draws the same held curve and gets the same treatment: cumulative hold,
click to reset, mirroring the Dock Vectorscope module, which already supports a click reset for its
own Max Hold. Without this the panel would hold cumulatively while the strip beside it decayed.

The Dock has no snapshot mode, so only the live half applies there.

## Architecture

### Where the hold is computed

In the frontend, per panel instance. Not in Rust, and not in the history storage.

- **Not Rust.** Rust would need a new IPC command to carry the reset, the change would land in the
  capture layer that CI does not cover, and snapshot mode would still show nothing, because the
  history stores the smoothed curve rather than the engine's peak state.
- **Not the history storage.** A hold maintained during ingest is what makes
  `StereoMapHistorySlab` expensive: cumulative prefixes are invalidated by row eviction, which
  forces a dirty-and-rebuild scheme and variable-size chunks. Stereo Map pays that because its hold
  is a cumulative statistic the live view needs as well. Spectrum's is not: the live hold is a
  per-panel value with a per-panel reset, so it belongs with the panel.
- **Per panel instance,** not shared per analysis key. The reset gesture reads as "reset this
  chart", which only holds if two panels showing the same key hold independently. This differs
  from Stereo Map, whose hold is deliberately shared across every view of one key.

### Modules

**`src/math/spectrumMaxHold.js`** (new, pure)

```text
accumulateSpectrumMaxHold(previous, dbList) -> Float32Array
  Per-band maximum. Reuses `previous` when the band count matches, so the live path allocates
  once per hold rather than once per frame. A different band count starts a new hold.

buildSpectrumMaxHoldTable(history, bucketRows) -> { table, bandCount, length, bucketRows, history }
  One cumulative prefix per bucket of `bucketRows` rows, over a frozen history.

spectrumMaxHoldAt(built, index) -> Float32Array
  The hold at `index`: the previous bucket's prefix, then a replay of at most `bucketRows` rows.
  Exact, not an approximation of the row-by-row fold.
```

**`SpectrumPanel.jsx`**

- Live: accumulate each frame's `smoothDb` into a ref while Max Hold is on; clear the ref on
  reset, on the control going off, and on a band-grid change.
- Snapshot: ask `useSnapshot` for the hold at the selected row.
- Both paths feed the existing `buildSpectrumPathFromData(data, peakDb, range)` call. The drawing
  code does not change; only the source of `peakDb` does.

**`useSnapshot.js`**

`resolveSpectrumSnapshotForKey` gains a `withMaxHold` option, alongside the Vectorscope path that
already works this way. The table is cached in a `WeakMap` keyed by the frozen history, and is
built only when a Spectrum panel with Max Hold on asks for it, so scrubbing without the feature
costs nothing.

**`DockSpectrum.jsx`**

The same live accumulation and click reset, mirroring `DockVectorscope`.

### Snapshot cost

Building the table is one pass over the retained rows: 958 bands times 90,000 rows at the default
one-hour retention, times 360,000 at the four-hour maximum — order 10^8 to 10^9 float comparisons,
so hundreds of milliseconds to about a second.

This is accepted, on the same terms as the Vectorscope's Polar Level table: the cost lands once,
when a snapshot is entered with the feature on, and is cached against the frozen history
afterwards. Scrubbing pays only the replay, at most `bucketRows` rows.

`bucketRows` is 1000 (40 s). At four hours that is 360 buckets, about 1.4 MB as Float32, and a
replay of at most 1000 rows per query.

If the build hitch turns out to be intolerable in use, moving to a table maintained during ingest
is a contained change: the table's shape stays, only what builds it moves. That decision should be
made against a measurement, not now.

### Rust

Unchanged in this work. `peakDb` / `peakPath` keep arriving in the frame payload and stop being
read. Deleting the decay envelope and those payload fields is a separate commit, after the new
behaviour has been confirmed on a real device — which keeps this change frontend-only and
revertible.

## Testing

- **`spectrumMaxHold.test.js`**: accumulation including non-finite input; reuse of the previous
  buffer when the band count matches; a new hold when it does not; table lookups compared against a
  naive row-by-row fold at bucket boundaries, inside buckets, at index 0 and at the last row; an
  empty history.
- **`SpectrumPanel.test.jsx`**: the held curve comes from the accumulated hold rather than the
  frame's `peakDb`; clicking the held curve resets it; the click does not capture a snapshot;
  turning the control off clears the hold; no hit target in snapshot mode or while the control is
  off.
- **`useSnapshot.test.jsx`**: the hold at the selected row matches the naive fold; the table is
  built once per frozen history; nothing is built when no panel asks for it.
- **`DockSpectrum.test.jsx`**: the held curve and the click reset, mirroring the existing
  `DockVectorscope` tests.

## Commits

1. `src/math/spectrumMaxHold.js` and its tests. Nothing wired; pure addition.
2. Live Max Hold in `SpectrumPanel`, the reset gesture, and the Max Decay → Max Hold wording.
3. Snapshot reconstruction through `useSnapshot`.
4. The Dock Spectrum module.

Each commit passes `npm run check` on its own.

## Out of scope

- Deleting the Rust decay envelope and the `peakDb` / `peakPath` payload fields.
- Exposing hold time or decay rate as settings; the decaying behaviour is being removed, not made
  configurable.
- Any change to Peak Labels, which are found on the live smoothed curve and never read the peak
  envelope.
- Any change to the Vectorscope or Stereo Map holds.
