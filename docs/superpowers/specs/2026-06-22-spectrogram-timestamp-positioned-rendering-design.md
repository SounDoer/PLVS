# Spectrogram Timestamp-Positioned Rendering

**Date:** 2026-06-22
**Status:** Draft

## Summary

Change the Spectrogram from frame-packed column rendering to timestamp-positioned
rendering: each visual frame is painted at the x position of its real timestamp
within the visible time window, instead of being laid out one-after-another by
array index. Gaps in a request key's history (a natural result of the
no-backfill per-instance analysis model) then render as real blank space, the
heatmap aligns with the time axis / selection line / frequency-change markers,
and we can draw data-availability boundary marker lines where a view's data
appears or disappears.

## Motivation

Per-instance analysis requests collect history with no backfill: when a
Spectrogram's channel chip switches to a new request key, that key only has
frames from the switch moment onward. Switching back and forth leaves a single
key's history split into multiple active stretches separated by gaps.

The current renderer packs frames by array index (`slot = leadingEmptySamples +
col`), which has two consequences once gaps exist:

1. **Interior gaps are invisible.** Two stretches far apart in time are drawn in
   adjacent columns; the gap is compressed away, so there is no spatial place to
   mark "no data here".
2. **The heatmap diverges from the time axis.** Columns are index-linear while
   the time ticks, selection line, and frequency-change markers are time-linear.
   They only agree when capture is gap-free.

This also produces a confusing UX: scrubbing a Spectrogram back to a time before
its current key started collecting shows an unexplained blank panel (see
`2026-06-20-per-instance-panel-controls-and-analysis-requests-design.md` §History
and §UI Empty States — the per-instant "No data" treatment fits the Spectrum
panel but not a time-window heatmap).

A full-panel "No data" overlay was considered and rejected: a spectrogram is a
window, so the desired cue is positional (where on the timeline data exists),
not a panel-covering message.

## Current Model

- `mapHistoryViewportToVisual` (`spectrogramViewportMath.js`) maps the visible
  history-sample window to a contiguous slice of the visual-frame array
  (`{ effectiveOffsetSamples, visibleSamples }` in visual-frame space).
- `spectrogramVisibleRange` (`config/scales.js`) turns that into
  `{ startIdx, count, leadingEmptySamples, windowSamples }`.
- `paintImageData` (`useSpectrogramCanvas.js`) paints `snaps[startIdx + col]` at
  `slot = leadingEmptySamples + col`, `x = slot * W / windowSamples` — purely
  index-based, no timestamps.
- Frequency-change markers position by history-sample index, linearly mapped to x.
- Hover (`computeSpectrogramHoverPoint`) maps x back through the same
  index-based viewport.

## Target Model

The visible window is a **time range** `[oldestMs, newestMs]` taken from the
loudness history timeline (the master clock the rest of the chart already uses).
Every visual frame is placed by timestamp:

```txt
x(ts) = (ts - oldestMs) / (newestMs - oldestMs) * W
```

Each frame paints a column ~one visual sample wide (`x(ts) .. x(ts + sampleMs)`).
Time spans with no frame are never painted, so they stay blank. Frames outside
`[oldestMs, newestMs]` are skipped.

### Time window derivation

New pure function:

```txt
spectrogramTimeWindow(historyEntries, effectiveOffsetSamples, visibleSamples)
  -> { oldestMs, newestMs } | null
```

Mirrors the window math already inside `mapByTimestamp`: newest visible history
index = `len - 1 - offset`, oldest = `newest - visible + 1`, read their
`timestampMs`. Returns null when history has no timestamps (renderer clears).

### Frame placement and gap rendering

- Binary-search the (chronologically ordered) frame array for the index range
  whose `timestampMs` falls in `[oldestMs, newestMs]` (avoid full-array scans;
  arrays can be large).
- For each frame in range: `xStart = round(x(ts))`,
  `xEnd = round(x(ts + sampleMs))`, `colW = xEnd - xStart`; skip if `colW <= 0`
  (sub-pixel when zoomed far out — same lossy behavior the packed renderer
  already has). Real gaps leave their pixels at the cleared background.
- `sampleMs = VISUAL_HIST_SAMPLE_SEC * 1000`.

### Data-availability boundary markers

New pure function:

```txt
spectrogramDataBoundaries(frames, oldestMs, newestMs, sampleMs)
  -> number[]   // timestamps to draw vertical marker lines at
```

- Group in-window frames into contiguous segments (a gap is a jump between
  consecutive frames `> gapFactor * sampleMs`; `gapFactor ≈ 1.8`).
- Emit a marker at a segment's **start** when it begins strictly inside the
  window (data appears here) and at a segment's **end** when it ends strictly
  inside the window (data stops here). Segment edges that coincide with the
  window edge are clipped, not marked (data continues beyond the view).
- Markers render in **both live and snapshot**, reusing the existing
  frequency-marker SVG style (dashed vertical line, viewBox `0 0 1000 1000`,
  `x = x(ts) / W * 1000`), with a hover `<title>` such as
  "No data for this view beyond this point".

### Hover

`computeSpectrogramHoverPoint` changes to: `ts = oldestMs + xFrac * (newestMs -
oldestMs)`, then pick the nearest in-window frame within `sampleMs` tolerance; if
none (hovering a gap), return null (no readout) rather than the nearest packed
column.

## Consistency

After this change the heatmap, time ticks, selection line (`selLineX`), and
frequency-change markers all share one time-linear x mapping. Frequency-change
markers may stay index-positioned (history is evenly ~10 Hz spaced, so
index-linear ≈ time-linear); converting them to timestamp x is optional and can
follow.

## Performance

Net impact is expected to be negligible: this is a structural change to *where*
columns are placed, not an algorithmically heavier render.

**Dominant cost is unchanged.** The real expense is the per-pixel fill in
`paintImageData`, which is O(W×H) (each column × each row × column width ≈ the
whole image). Both the packed and timestamp-positioned renderers fill the same
pixel grid. The rAF loop also keeps its `lastPaintRef` early-return, so it only
truly repaints on a new frame (~25 Hz) or on scrub/zoom — that frequency does
not change.

**Added work is small and outside the per-pixel loop.**

| Added | Complexity | Notes |
|-------|-----------|-------|
| Binary-search the in-window frame range | O(log n) | replaces the old O(1) index math; microseconds |
| `x(ts)` per column | same magnitude as `slot * W / windowSamples` | one float op per column |
| `spectrogramDataBoundaries` gap scan | O(frames-in-window) | must be memoized — see below |

**The one thing to watch: boundary-scan call frequency.** `SpectrogramPanel`
re-renders at ~30–60 Hz (it reads the audio context, which is recreated on each
`setAudio`). Recomputing `spectrogramDataBoundaries` every render would scan up
to thousands–tens-of-thousands of in-window frames each time. Mitigation:
`useMemo` keyed on `[frames identity, oldestMs, newestMs]` so it recomputes only
when the window or data actually changes (~25 Hz at most). Even unmemoized a
few-thousand-element loop is sub-millisecond; memoized it is unmeasurable.

**Slightly cheaper with gaps.** Blank time spans are not painted (left at the
cleared background), so the more gaps a key's history has, the fewer pixels are
written versus the always-full packed renderer.

**Mechanics.**

- Repaint cache key (`lastPaintRef`) moves from `{len, offset, visible, sel}` to
  include `{oldestMs, newestMs, len, sel}`.
- No per-frame allocations in the paint loop (reuse `ImageData`).
- Window selection via binary search keeps frame lookup O(log n) even for long
  (2 h) histories.

## Edge Cases

- Window entirely before a key's first frame (the reported scenario): no
  in-window frames → blank canvas, no markers (the boundary is off-screen to the
  right). This is acceptable; the blank now has a consistent meaning and the
  adjacent visible window will show the start marker once it scrolls into view.
- Single continuous segment spanning the whole window: no markers (data
  everywhere).
- Zoomed far out (many frames per pixel): last write wins per pixel, same as the
  packed renderer.
- Empty history / no timestamps: clear canvas.

## Out of Scope

- Converting frequency-change markers to timestamp positioning (optional
  follow-up).
- Any change to live spectrum/vectorscope rendering.
- Showing a full-panel "No data" message for the Spectrogram.
- Backfilling history for newly activated request keys.

## Open Implementation Notes

- `mapHistoryViewportToVisual` and `spectrogramVisibleRange` lose their
  Spectrogram caller; remove them if no other consumer remains, otherwise leave
  and stop using them from the panel.
- Decide marker end-edge position: at the last frame's `ts` vs `ts + sampleMs`
  (right edge of its column). Lean to `ts + sampleMs` so the line sits at the
  visual end of the data.

## Testing Notes

- `spectrogramTimeWindow`: offset/visible → correct `{oldestMs, newestMs}`;
  null when history lacks timestamps; clamping at array ends.
- `spectrogramDataBoundaries`: single segment (no markers), leading gap (start
  marker), trailing gap (end marker), interior gap from switch-back-and-forth
  (two markers), edges clipped at window bounds, empty input.
- Hover mapping: xFrac inside a segment resolves the nearest frame; xFrac in a
  gap returns null.
- Canvas paint is not unit-tested directly; correctness rides on the pure
  functions above plus on-device visual verification.

## Verification

Visual correctness (gaps render as blank, heatmap aligns with time ticks,
markers land at segment edges, scrubbing across a gap) must be checked on the
desktop build (`npm run tauri dev`) — the browser preview cannot run the Tauri
audio path.
