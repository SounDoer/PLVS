# Per-instance Panel Controls and Analysis Requests

**Date:** 2026-06-20
**Status:** Draft

## Summary

Upgrade panel controls from one global control object to per-panel-instance
controls, and upgrade backend analysis from one global Spectrum/Vectorscope
selection to a deduplicated active request set.

The goal is that two instances of the same module can show different chip states
at the same time:

```txt
Level Meter 1: Peak
Level Meter 2: M
Spectrum 1: L/R Combined
Spectrum 2: C Combined
Vectorscope 1: L/R
Vectorscope 2: L/C
```

This spec follows `2026-06-20-panel-instance-workspace-design.md`. That earlier
slice allowed multiple panel instances but intentionally kept `panelControls`
global. This slice removes that limitation.

## Motivation

Once duplicate panels exist, users expect each panel header chip to affect only
that panel. The current global control model violates that expectation:

```txt
change Spectrum 1 channel -> Spectrum 2 changes too
change Level Meter 1 mode -> Level Meter 2 changes too
```

Some controls are cheap frontend display choices, but others affect backend DSP
work. Treating all controls as local UI state would create incorrect displays
for Spectrum, Spectrogram, and Vectorscope. The backend must know which analysis
results are currently required.

## Current Model

Current workspace state stores a single global `panelControls` object:

```txt
WorkspaceState = {
  tree,
  panelsById,
  panelOrder,
  fullscreenId,
  panelControls
}
```

The Rust app state also stores global analysis selections:

```txt
vectorscope_pair: one pair
spectrum_channel: one channel or pair
spectrum_view: one view
```

The capture pipeline owns one `SpectrumMeter` and one `VectorscopeMeter`, then
emits one `AudioFramePayload` containing one spectrum result and one vectorscope
result.

That model cannot support two simultaneously different Spectrum or Vectorscope
panels.

## Target Workspace Model

Replace global workspace `panelControls` with per-instance controls:

```txt
WorkspaceState = {
  tree: TreeNode<PanelId> | null,
  panelsById: Record<PanelId, PanelInstance>,
  panelOrder: PanelId[],
  panelControlsById: Record<PanelId, PanelControls>,
  fullscreenId: PanelId | null
}
```

Rules:

- every panel instance reads controls from `panelControlsById[panelId]`;
- missing controls are normalized from `DEFAULT_PANEL_CONTROLS`;
- adding a panel creates a new default controls object;
- adding a duplicate panel does not copy controls from an existing sibling;
- deleting a panel deletes `panelControlsById[panelId]`;
- moving a panel does not change its controls because controls follow the panel
  id;
- no migration is required from old workspace or old presets.

`DEFAULT_PANEL_CONTROLS` remains as a default template and normalization source.
It is no longer the live global UI state.

## Per-instance Controls Scope

All header chips are per-instance in this slice:

- Level Meter: `levelMeterMode`;
- Loudness History: visible layers;
- Loudness Stats: visible metrics and metric order;
- Spectrum: selected channel, view mode, peak hold;
- Spectrogram: selected channel;
- Vectorscope: selected pair.

Pure display controls can be applied entirely in the frontend. Backend-affecting
controls become analysis requests.

## Analysis Requests

The backend should not maintain one analysis state per panel id. It should
maintain one analysis state per unique request key.

Example:

```txt
Spectrum A wants L/R Combined
Spectrum B wants L/R Combined
Spectrum C wants C Combined
```

The backend should calculate:

```txt
spectrum:pair:0:1:combined
spectrum:single:2:combined
```

`Spectrum A` and `Spectrum B` share the same result.

### Request Key Shape

Request keys are stable strings derived from the normalized control state.

Spectrum-like keys:

```txt
spectrum:pair:<x>:<y>:combined
spectrum:pair:<x>:<y>:lr
spectrum:pair:<x>:<y>:ms
spectrum:single:<ch>:combined
```

Spectrogram uses the same spectrum-like calculation key when it asks for the
same channel/view calculation, but its history consumer differs.

Vectorscope keys:

```txt
vectorscope:pair:<x>:<y>
```

Peak hold is not part of the request key. The backend may emit current smooth
and peak paths once; the frontend decides whether a specific Spectrum panel
shows peak hold.

Level Meter and Loudness display controls do not create backend requests in this
slice because they can read from shared peak/loudness data.

### Active Request Set

The frontend derives an active request set from the currently mounted panel
instances and their normalized controls.

Panel lifecycle:

- adding a panel may add a new request;
- deleting a panel may remove a request if no other panel uses it;
- changing a chip changes the panel's request binding;
- applying a preset rebuilds the request set from restored panel controls;
- app restart rebuilds the request set from persisted workspace state.

The backend receives the complete active request set through one aggregate IPC
command, for example:

```txt
set_analysis_requests(requests)
```

Existing global commands such as `set_spectrum_channel`,
`set_spectrum_view`, and `set_vectorscope_pair` may remain temporarily, but new
per-instance UI should stop depending on them.

## Realtime Payload

The payload should move from single result fields to result maps keyed by request
key.

Conceptually:

```txt
AudioFramePayload = {
  sharedPeak,
  sharedLoudness,
  spectrumResultsByKey,
  vectorscopeResultsByKey,
  ...
}
```

Each panel resolves its current request key from `panelControlsById[panelId]`,
then reads the matching result from the frame.

If the result is missing in live mode, the panel shows a lightweight pending
state until the first frame for that request arrives.

## History Model

History belongs to request keys, not panel ids.

```txt
spectrumHistoryByKey[requestKey]
vectorscopeHistoryByKey[requestKey]
```

A panel in snapshot mode uses its current controls to derive the request key,
then looks up history for that key at the selected timestamp.

If the request did not exist at that historical time, the panel shows:

```txt
No data for this view at selected time
```

### Chip Changes During Capture

Changing a chip does not migrate history.

Example:

```txt
10:00 Spectrum A = spectrum:pair:0:1:combined
10:05 Spectrum A changes to spectrum:single:2:combined
```

Behavior:

- the panel immediately reads the new request;
- if the new request is not already active, it starts collecting from 10:05;
- the old request stops realtime calculation if no panel still uses it;
- old request history is not immediately deleted;
- if the user later switches back, existing old request history can still be
  shown until normal history caps or lifecycle cleanup remove it.

### No Backfill

New requests do not backfill history.

The app does not retain enough raw PCM to recalculate arbitrary future requests,
and storing raw audio for this purpose would create large memory, privacy, and
performance costs.

## Request Caps

High-cost request types must be capped.

Initial v1 cap:

```txt
max unique spectrum-like requests: 4
max unique vectorscope requests: 4
```

When a user or preset creates more unique requests than the cap:

- workspace and panel controls still restore;
- the backend activates only the first allowed requests in deterministic panel
  order;
- panels whose request is over the cap show:

```txt
Too many active analysis views
```

This is preferred over preventing chip changes, because preset restore can
otherwise fail or mutate user state unexpectedly.

The cap applies to unique request keys, not panel count.

## Compute and Memory Behavior

The active request set allows optional heavy analysis to stop when no panel needs
it.

Examples:

- no Spectrum or Spectrogram panels -> no spectrum-like request calculation;
- no Vectorscope panels -> no vectorscope request calculation;
- two panels with the same Spectrum request -> one calculation shared by both.

Shared low-cost core metrics may continue to run globally:

- peak;
- loudness basics;
- waveform and basic timeline data;
- channel metadata.

Spectrum-like history is the largest memory risk because spectrogram-style views
store continuous frequency data over time. History caches should be bounded by
the existing global history window and by request caps. Inactive request history
may be a preferred eviction target under future memory pressure.

## Presets

Presets capture and restore:

```txt
tree
panelsById
panelOrder
panelControlsById
windowBounds?
windowPinned?
focusView?
```

Presets no longer capture global `panelControls`.

Applying a preset restores panel instances and per-instance controls exactly,
then rebuilds the active request set. If the restored preset exceeds request
caps, over-cap panels keep their controls but show the over-cap empty state.

Manual per-instance control changes clear `presetsStore.activeId`.

## Clear, Stop, and Restart

Clear:

- clears shared metric history;
- clears active request history;
- clears retained inactive request history.

Stop capture:

- stops active request calculation;
- follows the existing app lifecycle for clearing or retaining in-memory
  histories.

Restart:

- persisted workspace restores `panelControlsById`;
- active requests are rebuilt from restored visible panels;
- runtime-only in-memory request history is not restored unless a future
  persistence slice explicitly adds it.

## UI Empty States

Panel states:

- live request created but no frame yet: existing pending/loading treatment;
- snapshot timestamp predates request history:
  `No data for this view at selected time`;
- request is over the active cap:
  `Too many active analysis views`;
- no capture data at all: existing no-data treatment.

## Out of Scope

- Migration from old `panelControls` workspace or presets.
- Raw audio retention for history backfill.
- Unlimited concurrent analysis requests.
- Per-panel DSP state keyed directly by panel id.
- New Duplicate Panel command that copies controls.
- Persisting runtime request history across app restarts.

## Open Implementation Notes

- Request derivation should be pure and testable in JS.
- Rust request key parsing should normalize/clamp channels against current
  channel count.
- Result maps should avoid duplicating large arrays for panels that share a
  request key.
- Existing frame history and snapshot resolution code will need a request-key
  dimension for Spectrum/Spectrogram and Vectorscope data.
- The frontend should remove inactive requests promptly, but the backend should
  tolerate stale request keys and missing results defensively.

## Testing Notes

- Workspace reducer tests cover `panelControlsById` initialization, update,
  delete, and preset restore.
- Frontend request derivation tests cover deduplication and cap ordering.
- IPC tests cover request parsing and rejection of malformed request keys.
- Pipeline tests cover multiple unique Spectrum and Vectorscope requests in one
  frame.
- History tests cover no-backfill behavior after chip changes.
- Snapshot tests cover missing request history empty states.
- Preset tests cover restoring per-instance controls and over-cap panels.
