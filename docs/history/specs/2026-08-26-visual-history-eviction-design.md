# Visual History Eviction — Design

## Summary

`FrameIntake` stores the Spectrum, Vectorscope and Stereo Map histories one slab per analysis
request key, and it has never dropped one. Every key the app has seen since the last capture
restart keeps a full-capacity slab alive for the rest of the session, whether or not any panel can
still read it.

Measured on the reporting machine's configuration (four-hour retention, 958-band grid, all eight
panels open): a single two-second drag of the Spectrum speed slider stranded **754 MB**, and each
abandoned long-lived key strands up to **1.38 GB** for Spectrum or **4.37 GB** for Stereo Map.

The drag half of that shipped as `3b38364f` (request-key sliders commit on release). This design
covers the other half: dropping the slabs themselves.

## What is not wrong

Ruled out by measurement before designing anything, so the fix stays aimed at the real cause:

- **Retention pruning works.** A single key at one-hour retention plateaus at ~1.74 GB RSS from
  minute 60 through minute 120 and does not climb.
- **The chunked-storage refactor is behaviour-preserving.** The same soak run against `v0.14.0`
  produces line-for-line identical memory and per-frame cost.
- **Per-frame ingest cost does not drift.** ~0.24 ms whether the window is empty or full.
- **Live display never reads a slab — for Spectrum.** `SpectrumPanel.jsx:189` reads the live
  result; only snapshot scrubbing resolves against history. Three other live paths do read the
  slab, though: `StereoMapPanel.jsx:258` and `DockStereoMap.jsx:54` call `liveHoldValues()` on it
  for Max Hold, and `VectorscopePanel.jsx:219` / `DockVectorscope.jsx:97` hand it to polar
  peak-hold. So Rule 2 evicting an open-but-unfed panel's slab does have a visible effect: that
  panel's Max Hold / polar peak-hold goes from frozen-stale to empty. This is still acceptable —
  it only happens after a full retention window with no data, at which point the held values were
  built entirely from rows already outside that window, i.e. from data the retention setting says
  should no longer be shown.

The 4.68 GB seen in the field is mostly the _designed_ footprint of a four-hour retention with this
panel set (~8.8 GB at a full window). That is a separate conversation about the retention setting;
this design does not change it.

## Product decisions

### The rollback promise is dropped

Today a key's slab outlives the key so that returning to an identical setting shows the old
history again. That promise is being given up deliberately:

- In the common case it buys nothing visible. After a setting change, scrubbing back already
  resolves against the _new_ key, whose slab has no row at that timestamp, so
  `resolveKeyedVisualIndex` reports `missing` and the panel shows `SnapshotEmptyState`. The old
  slab is unreachable — it only occupies memory.
- Cashing it in requires every key component to match again (speed, tilt, smoothing, channel,
  view), and even then the history has a hole covering the time the key was inactive.
- Nothing in the UI tells the user the promise exists.

Closing a panel likewise drops its history. Closing a panel is a stronger "I am done with this"
signal than changing a setting.

### Eviction pauses while capture is stopped

`beginCaptureSession` only offsets the timestamp domain; it does not clear history, so stopping
and starting again keeps accumulating into the same slabs. After a stop, what is in memory is the
whole recording and it can never refill.

So eviction must not run while stopped. This falls out of the mechanism rather than needing a
flag: the sweep runs on visual-frame arrival, and no frames arrive while stopped.

## Architecture

### Two rules, one clock

Both rules run in the same sweep, on the visual timestamp domain shared by every key, so comparing
a live row against a dead slab's newest row is meaningful.

**Rule 1 — need.** A key that no open panel needs, continuously for `EVICTION_GRACE_MS`, is
dropped.

**Rule 2 — age.** A slab whose newest row has fallen entirely outside the retention window is
dropped, whether or not a panel still needs its key.

Rule 2 is not redundant. Rule 1 keeps a key alive while its panel is open, but a panel can be open
and still receive nothing — it lost the four-request cap, or the dock took its slot. Such a slab
freezes: expiry is driven by appends (`ChunkedHistorySlab.js:77` is the only `_dropExpiredChunks`
call site, and `StereoMapHistorySlab.js:750` mirrors it), so with no appends nothing ever ages out
and the slab holds rows from outside the retention window indefinitely. Bounded waste rather than
a leak, but at four-hour retention one such Spectrum slab is 1.38 GB.

### The grace period is a safety margin, not a feature

`EVICTION_GRACE_MS = 3000`. It exists so the sweep never acts on a state that is mid-transition.
It is not "change back within three seconds and your history returns" — that promise was dropped
above, and nothing should be written down that invites users to rely on it.

`nowMs` here is the normalized visual timestamp, i.e. media time, not wall-clock time. During file
analysis a single `visualHistBatch` can advance media time well past 3 s inside one synchronous
`applyFrame`, so the margin collapses to roughly zero in that path. That is harmless — the
dangerous ordering this grace period guards against is closed elsewhere — and dropping an abandoned
key faster there is the intended outcome, not a bug.

### Where the retained key set comes from

**Not** from the request list handed to Rust. That list answers "what should the engine compute
right now", which is a different question from "whose history should survive", and it diverges in
three places:

| Divergence                            | Why the request list is wrong for retention                                    |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `capRequests` four-key cap            | A panel that lost the cap is still open and still wants its history            |
| The dock merge squeeze                | Squeezed panel requests land in neither the active list nor `overCap*Requests` |
| `channelCount >= 2` availability gate | Derived from live frame shape, so a device blip would delete history           |

Retention keys are therefore computed straight from the open panels with
`spectrumRequestKeyFromControls`, `vectorscopeRequestKeyFromControls` and
`stereoMapRequestKeyFromControls`, applying **no** cap, **no** dock merge and **no** availability
gate.

Skipping the availability gate is what makes the `channelCount` hazard structural rather than
something the grace period has to outlast. A retained key with no slab costs nothing: slabs are
created lazily on first data, so a key that never receives a row never allocates.

Workspace panels and dock modules are both retained regardless of the current `docked` state.
`AppShell.jsx:62` renders one or the other, so whichever is hidden comes back intact.

### Modules

- `src/analysis/analysisRequests.js` — add `deriveRetainedAnalysisKeys(state)`, returning
  `{ spectrum: Set, vectorscope: Set, stereoMap: Set }` for the workspace half. It reuses the tree
  walk and key builders already in this file.
- `src/dock/dockAnalysisRequest.js` — add `mergeDockRetainedKeys(retained, dockPanels)` for the
  dock half, mirroring how `mergeDockAnalysisRequests` layers on top of `deriveAnalysisRequests`.
  The dock layer already imports the analysis layer; keeping the dependency pointing this way
  avoids a cycle.
- `src/lib/FrameIntake.js` — add `setRetainedVisualKeys(keysByFamily, windowMs)` and a private
  sweep run at the end of `pushVisualHistRow`.
- `src/App.jsx` — memoize the retained key set and push it into every ingesting intake
  (`useIntakeRouting`'s `ingestingIntakes`: live + file-analysis), not just `intakeRef.current`.
- `src/hooks/useIntakeRouting.js` — exposes `ingestingIntakes`, the set of intakes `App.jsx` calls
  `setRetainedVisualKeys` on.

`deriveRetainedAnalysisKeys` must not reach `workspace/registry.jsx`. `analysisRequests.js` already
imports `panelInstances.js` and `panelControlInstances.js` only, which is the safe side of the trap
recorded in AGENTS.md.

### Eviction is safe during a snapshot

`freezeChunks` shares sealed chunks by reference but the frozen view holds its own chunk array, so
deleting a slab from the live map cannot damage an open snapshot. The frozen view keeps those
chunks alive, which means eviction does not return memory until the snapshot is closed. That is
correct, and worth knowing when reading a memory graph.

Evicting also makes _entering_ a snapshot cheaper: `snapshotVisual*ByKey` freezes every key, and a
dead slab's last chunk is unsealed, so it is cloned on every snapshot entry — about 3.9 MB per dead
Spectrum key and 11.8 MB per dead Stereo Map key.

## The dock status inconsistency

Separate from eviction, and included because the same investigation surfaced it.

`mergeDockSpectrumRequest`, `mergeDockVectorscopeRequest` and `mergeDockStereoMapRequest` each drop
panel requests to make room (`dockAnalysisRequest.js:78-81` and its two siblings) but carry
`statusByPanelId` and `overCap*Requests` through unchanged via `...derived`. A squeezed panel keeps
the `"active"` status set in `deriveAnalysisRequests` while its request never reaches Rust.

**This has no user-visible symptom today**, and the fix does not create one:

- Squeezed workspace panels are not rendered while docked (`AppShell.jsx:62`).
- Dock modules never read `analysisStatus` — no module under `src/dock/modules/` references it.

It is fixed as an internal invariant: _every request that does not reach the final set is recorded
in `overCap*Requests` and its panel ids marked `"overCap"`_. That includes dock requests dropped by
the final `.slice(0, MAX_*_REQUESTS)`, so the invariant holds without exceptions.

Dock priority is deliberately unchanged. The dock wins slots because the panels are not on screen
while it is showing; giving slots to hidden panels would starve the visible strip.

## Testing

- `src/analysis/analysisRequests.test.js` — retained keys ignore the cap; ignore the availability
  gate; cover both Spectrum and Spectrogram panels in the one Spectrum family.
- `src/dock/dockAnalysisRequest.test.js` — retained keys include dock modules; squeezed panel
  requests are marked `overCap` and land in `overCap*Requests`.
- `src/lib/FrameIntake.test.js` — an unneeded key survives inside the grace window and is dropped
  after it; a needed key is never dropped; a needed-but-unfed slab is dropped by the age rule; the
  sweep does not run without a frame.

The capture layer is untouched, so `smoke:capture` and `soak:capture` are not implicated.

## Out of scope

- The four-hour retention footprint itself.
- Moving Spectrum tilt to the render side so it leaves the request key (`3b38364f` left
  `commitOnRelease` on tilt as an interim).
- Any dock over-cap indicator. The invariant above makes one possible; building one is a feature.
- Dock-versus-panel slot priority.
