# Spectrum Max Hold — Design

**Date:** 2026-08-25
**Status:** Approved in product discussion

## Summary

The Spectrum's filled area gains a second reading. **Max** is one control with three values:

| Max   | The fill's upper edge is                                                    |
| ----- | --------------------------------------------------------------------------- |
| Off   | the live curve, as before                                                   |
| Decay | the engine's peak envelope: holds 1.5 s, then falls 8 dB/s                  |
| Hold  | the maximum since Hold was selected or cleared, accumulated in the frontend |

Decay is the behaviour that shipped; Hold is new. They are one choice rather than two switches
because they are two readings of the same fill.

## Revision, 2026-08-25

This design was first written as "replace Decay with Hold", then as "add Hold as a second control
drawn as a thin outline". Both are superseded. The outline version was built and tried on a real
device: with L/R or M/S selected the chart carried six shapes — two live curves, two decay fills,
two held lines — and the reading was lost among them.

What survives from that build: the hold arithmetic, the snapshot prefix table, the accumulation in
the panel and the Dock, and the stroke-only click target. What went: the held line as a separate
mark, and the second switch.

## Product decisions

### Behaviour

- Hold is the per-band maximum of the smoothed curve since Hold was selected or last cleared. It
  never decays.
- It applies to both curves: in L/R and M/S each fill holds its own curve.
- It is cleared by clicking the upper edge of a fill, by leaving Hold, and by a change of analysis
  key. The panel resets on a changed key rather than on a changed band count — two grids can share
  a count and mean different things.
- In snapshot mode the fill shows the hold **as it stood at the selected row**, reconstructed from
  the retained history. Decay has no snapshot reading and draws no fill there, as before.
- Only one reading at a time. Nothing draws a hold and a decay together.

### The control

One row, one persisted key:

```text
Max        [Decay ▾]        off | decay | hold
```

`SettingsSelect`, the widget every other mode row in the app already uses (Level Meter, Spectrogram
and Stereo Map all name their mode this way). Inline segmented chips would read well here but do
not exist in this codebase, and one control does not justify a new widget family.

Off is a value of the mode rather than a switch in front of it: the three states are one choice in
the user's head, not two. The cost is that leaving Hold for Off forgets which mode was selected —
one click to restore, and not worth a second key that could hold a meaningless combination.

The persisted key is **`spectrumMaxMode`**. The switches it replaces are read as legacy input on
that row: `spectrumMaxDecay`, `spectrumMaxHold` and `spectrumPeakHold` all mean `decay`,
`spectrumMaxHoldTrace` means `hold`, and Decay wins if a stored record somehow carries both —
Decay is the one users have actually been running. The Dock's short names, `maxHold` and
`peakHold`, map onto `spectrumMaxDecay` so one migration serves both surfaces.

### Clear gesture

Clicking the upper edge of a fill clears the hold — both fills at once in L/R and M/S. One switch,
one hold, one clear.

The Spectrum chart's plain left click is already taken: it captures a snapshot, and double click
returns to live. So the target is the edge, not the area:

- The hit target is a dedicated invisible path along the fill's contour: `fill="none"`, a widened
  transparent stroke (~10 px), `pointerEvents="stroke"`. The filled area itself stays
  `pointerEvents="none"`; a clickable fill would turn most of the chart into a clear button and
  swallow snapshot clicks.
- The handler stops the click reaching the chart's snapshot handler.
- The hit path exists only in Hold mode, and only while the panel is live.

**Known risk, accepted:** where the edge lies over the point the user wants to click, the ~10 px
strip takes a click meant for the snapshot capture. Fallbacks if that annoys in use: Ctrl-click, or
a reset button on the settings row. Neither is built now.

### Dock

The Dock Spectrum module carries the same mode and the same hold. It has no snapshot, so its fill
is the live hold or nothing.

The clear is on the module rather than on the edge, matching the Dock Vectorscope module: in a
strip tens of pixels tall a contour is not a click target.

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

- Live: accumulate the frame's `smoothDb` and `smoothDbB` into refs while Hold is selected; clear
  on click, on leaving Hold, and on an analysis-key change. The accumulation resets during render
  rather than in an effect: an effect runs after the render that already folded a frame in, so on
  mount it would discard the first frame and leave the hold trailing by one.
- Snapshot: ask `useSnapshot` for the hold at the selected row.
- The mode picks the fill's contour — the hold, the engine's peak, or the live curve — and the
  existing fill rendering takes it from there.

**`useSnapshot.js`**

`resolveSpectrumSnapshotForKey` gains a `withMaxHold` option, alongside the Vectorscope path that
already works this way. The table is cached in a `WeakMap` keyed by the frozen history and built
only when a Spectrum panel with Max Hold on asks for it, so scrubbing without the feature costs
nothing.

**`DockSpectrum.jsx`**

The same live accumulation and mode-driven fill, with the clear on the module.

**Settings**

`SpectrumDisplaySettingsRows` is shared by the panel and the Dock, so the Max row is written once
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

- **`spectrumMaxHold.test.js`**: accumulation, including non-finite input and a first frame; reuse
  of the previous buffer when the band count matches and a fresh buffer when it does not; table
  lookups compared against a naive row-by-row fold at bucket boundaries, inside a bucket, at index
  0 and at the last row; a history whose rows carry no second curve; an empty history.
- **`panelControls.test.js`**: every mode id survives; an unknown value falls back to off; each
  replaced switch maps to its mode; Decay wins when both are stored; the replaced keys are gone
  from the normalized record.
- **`dockModuleControls.test.js`**: the Dock's short names reach the mode; the Dock Spectrum subset
  carries it.
- **`SpectrumPanel.test.jsx`**: the fill's edge is the hold in Hold, the engine's peak in Decay and
  the live curve with Max off, each checked against the path the band values produce; both fills
  hold in L/R; clicking an edge clears both without capturing a snapshot; the clear target exists
  only in Hold.
- **`useSnapshot.test.jsx`**: the hold at the selected row matches the naive fold, and nothing is
  built when no panel asks.
- **`DockSpectrum.test.jsx`**: the fill follows the hold; the clear target exists only in Hold;
  clicking the module clears.

## Commits

The outline design shipped in five commits (c8c01cf8, 5ed71a93, e88f1bd5, 14330bcf, 392f1341).
This revision replaces the rendering and merges the controls on top of them, keeping the hold
arithmetic and the snapshot reconstruction those commits introduced.

## Out of scope

- Any change to Decay's behaviour or its Rust envelope.
- A new theme role: the fill keeps the colours it already has.
- Peak Labels, which are found on the live smoothed curve and never read the fill.
- The Vectorscope and Stereo Map holds.
