# Spectrum Max Hold — Design

**Date:** 2026-08-25
**Status:** Approved in product discussion

## Summary

Add a cumulative **Max Hold** to the Spectrum panel and the Dock Spectrum module, alongside the
existing decaying envelope, which stays exactly as it is.

The two are different instruments and both stay available:

|               | Max Decay (existing)                     | Max Hold (new)                                  |
| ------------- | ---------------------------------------- | ----------------------------------------------- |
| What it shows | the peak of the last few seconds         | the maximum since it was switched on or cleared |
| Behaviour     | holds 1.5 s, then falls 8 dB/s           | never falls                                     |
| Computed in   | Rust, per frame, with the smoothing pass | the frontend, per panel                         |
| Drawn as      | filled area                              | thin outline, one per curve                     |
| Cleared by    | itself, by decaying                      | clicking the line                               |
| In snapshot   | absent                                   | reconstructed at the selected row               |

Nothing about Max Decay changes: same Rust envelope, same filled area, same behaviour. Only its
persisted key is renamed, for the reason below.

## Product decisions

### Naming

The persisted key `spectrumMaxHold` currently holds the **decaying** control, whose settings label
has always read "Max Decay". Leaving it there would mean `spectrumMaxHold` means Max Decay and
some other key means Max Hold, which every later reader has to learn the hard way.

- The existing control moves to **`spectrumMaxDecay`**, with `spectrumMaxHold` and `spectrumPeakHold`
  as legacy names on that row. Stored workspaces and presets keep their value and rewrite
  themselves on first load, the same way earlier renames in this table work.
- The new control is **`spectrumMaxHoldTrace`**, labelled **Max Hold**, default off.
- `spectrumMaxHold` is retired as a name: it is never reused for the new control. A stored
  `spectrumMaxHold: true` means the user had Max Decay on, and must not silently switch on a
  feature they have never seen.
- The Dock's own legacy short names (`maxHold`, `peakHold`) move with the row to
  `spectrumMaxDecay`.

### Behaviour

- Max Hold is the per-band maximum of the smoothed curve since the control was switched on or last
  cleared. It never decays.
- It applies to both curves. In L/R and M/S views the panel draws **two** held lines, one per
  curve; in Combined view, one.
- It is cleared by: clicking either held line, switching the control off, and a change of analysis
  key. The panel resets on a changed key rather than on a changed band count — two grids can share
  a count and mean different things.
- In snapshot mode the held lines show the hold **as it stood at the selected row**, reconstructed
  from the retained history.
- Max Decay and Max Hold are independent switches and can both be on. The chart then carries the
  live curve, the decay fill and the hold outline — doubled in L/R and M/S. Whether that is too
  busy is a judgement for a real device; no limit is built.

### Appearance

Thin outlines in the curves' own colours — `--ui-spectrum-primary` and `--ui-spectrum-secondary`,
and their `-snap` variants in snapshot mode — matching how the Vectorscope's Polar Level hold
draws with the trace colour. Reduced opacity if the line competes with the live curve. No new
theme role: adding one to Theme V2 costs more than this line is worth.

### Clear gesture

Clicking either held line clears **both**. One switch, one hold, one clear; clearing half of it
would leave the user unsure whether the gesture worked.

The Spectrum chart's plain left click is already taken — it captures a snapshot, and double click
returns to live — so the target is the line itself, following the Level Meter idiom the help
already states as `Click marker - Reset TP Max`. Three requirements:

- Each line gets a dedicated invisible hit path: `fill="none"`, a widened transparent stroke
  (~10 px), `pointerEvents="stroke"`. Nothing else about the hold is clickable.
- The handler stops the click reaching the chart's snapshot handler, through the existing
  `suppressChartClickRef` mechanism or `stopPropagation`.
- The hit paths exist only while Max Hold is on and the panel is live. In snapshot mode the lines
  come from history and there is nothing to clear.

Cursor feedback on hover marks the line as a control.

**Known risk, accepted:** where a held line lies over the point the user wants to click, the
~10 px strip takes a click meant for the snapshot capture. If that annoys in practice the
fallbacks are Ctrl-click or a button in the settings row. Neither is built now.

### Dock

The Dock Spectrum module gets the same control, the same live hold and the same click-to-clear,
mirroring the Dock Vectorscope module, which already carries its own Max Hold and clears it on
click. Without it the panel would hold while the strip beside it did not.

The Dock has no snapshot mode, so only the live half applies there.

**Open to revisit after seeing it:** the Dock strip is only tens of pixels tall, and a thin line
over a filled area may be unreadable there. If it is, dropping the Dock half is a clean revert of
one commit.

## Architecture

### Where the hold is computed

In the frontend, per panel instance. Not in Rust, and not in the history storage.

- **Not Rust.** It would need a new IPC command to carry the clear, it would land in the capture
  layer that CI does not cover, and snapshot mode would still show nothing, because the history
  stores the smoothed curve rather than any engine-side hold state.
- **Not the history storage.** A hold maintained during ingest is what makes
  `StereoMapHistorySlab` expensive: row eviction invalidates cumulative prefixes, which forces a
  dirty-and-rebuild scheme and variable-size chunks. Stereo Map pays that because its hold is a
  cumulative statistic its live view needs too. Spectrum's is not: it is a per-panel value with a
  per-panel clear.
- **Per panel instance,** not shared per analysis key. "Click this line to clear this chart" only
  holds if two panels on the same key hold independently. Stereo Map deliberately does the
  opposite, sharing one hold across every view of a key.

### Modules

**`src/math/spectrumMaxHold.js`** (new, pure)

```text
accumulateSpectrumMaxHold(previous, dbList) -> Float32Array
  Per-band maximum. Reuses `previous` when the band count matches, so the live path allocates once
  per hold rather than once per frame. Non-finite input leaves the band untouched.

buildSpectrumMaxHoldTable(history, bucketRows) -> { tableA, tableB, bandCount, length, bucketRows, history }
  One cumulative prefix per bucket of `bucketRows` rows, for both planes, over a frozen history.
  Rows without a second curve leave the B plane untouched.

spectrumMaxHoldAt(built, index) -> { dbList, dbListB }
  The hold at `index`: the previous bucket's prefix, then a replay of at most `bucketRows` rows.
  Exact, not an approximation of the row-by-row fold.
```

**`SpectrumPanel.jsx`**

- Live: accumulate the frame's `smoothDb` and `smoothDbB` into refs while Max Hold is on; clear on
  click, on the control going off, and on an analysis-key change.
- Snapshot: ask `useSnapshot` for the hold at the selected row.
- Draw each held plane through the existing `buildSpectrumPathFromData(data, values, range)` call,
  as a stroked path, plus its invisible hit path. The Max Decay fill is untouched.

**`useSnapshot.js`**

`resolveSpectrumSnapshotForKey` gains a `withMaxHold` option, alongside the Vectorscope path that
already works this way. The table is cached in a `WeakMap` keyed by the frozen history and built
only when a Spectrum panel with Max Hold on asks for it, so scrubbing without the feature costs
nothing.

**`DockSpectrum.jsx`**

The same live accumulation and click-to-clear, mirroring `DockVectorscope`.

**Settings**

`SpectrumDisplaySettingsRows` is shared by the panel and the Dock, so the new toggle is added once
and appears in both.

### Snapshot cost

Building the table is one pass over the retained rows, for two planes: 958 bands times 90,000 rows
at the default one-hour retention, times 360,000 at the four-hour maximum — order 10^8 to 10^9
float comparisons, so hundreds of milliseconds to a second or two.

Accepted on the same terms as the Vectorscope's Polar Level table: the cost lands once, on
entering a snapshot with the feature on, and is cached against the frozen history afterwards.
Scrubbing pays only the replay, at most `bucketRows` rows.

`bucketRows` is 1000 (40 s). At four hours that is 360 buckets for two planes, about 2.8 MB as
Float32.

If the build proves too slow in use, moving to a table maintained during ingest is a contained
change: the table's shape stays, only what fills it moves. That decision needs a measurement, not
a guess now.

### Rust

Untouched. Max Decay keeps using the engine's envelope exactly as today, so `peakDb` / `peakPath`
stay in the frame payload and stay in use.

## Testing

- **`spectrumMaxHold.test.js`**: accumulation, including non-finite input and a first frame;
  reuse of the previous buffer when the band count matches and a fresh buffer when it does not;
  table lookups compared against a naive row-by-row fold at bucket boundaries, inside a bucket, at
  index 0 and at the last row; a history whose rows carry no second curve; an empty history.
- **`panelControls.test.js`**: a stored `spectrumMaxHold` reads as `spectrumMaxDecay`; it does
  **not** switch on `spectrumMaxHoldTrace`; `spectrumPeakHold` still reaches Max Decay through the
  older alias.
- **`dockModuleControls.test.js`**: the Dock's `maxHold` / `peakHold` short names reach
  `spectrumMaxDecay`.
- **`SpectrumPanel.test.jsx`**: held lines come from the accumulated hold, not from the frame's
  `peakDb`; two lines in L/R and M/S, one in Combined; clicking a line clears both; the click does
  not capture a snapshot; switching the control off clears the hold; no hit paths in snapshot mode
  or while the control is off; Max Decay still draws its fill with Max Hold on.
- **`useSnapshot.test.jsx`**: the hold at the selected row matches the naive fold; the table is
  built once per frozen history; nothing is built when no panel asks.
- **`DockSpectrum.test.jsx`**: the held line and the click-to-clear, mirroring the existing
  `DockVectorscope` tests.

## Commits

1. `src/math/spectrumMaxHold.js` and its tests. Nothing wired; pure addition.
2. Controls: rename the existing row to `spectrumMaxDecay` with its legacy names, add the
   `spectrumMaxHoldTrace` row, add the settings toggle. The toggle draws nothing yet.
3. `SpectrumPanel`: live hold, the held lines, the click-to-clear.
4. Snapshot reconstruction through `useSnapshot`.
5. The Dock Spectrum module.

Each commit passes `npm run check` on its own.

## Out of scope

- Any change to Max Decay's behaviour, its Rust envelope, or its filled rendering.
- A new theme role for the held line.
- Peak Labels, which are found on the live smoothed curve and never read either hold.
- The Vectorscope and Stereo Map holds.
