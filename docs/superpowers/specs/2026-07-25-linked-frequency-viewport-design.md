# Optional Linked Frequency Viewport — Design

**Date:** 2026-07-25  
**Status:** Draft for owner review  
**Phase:** 3, after Shared Spectral Engine and Stereo Map

## Summary

Let Workspace frequency panels optionally share one persisted frequency range.
Spectrum uses it on X, Spectrogram uses it on frequency Y, and Stereo Map uses it on
X. Linking is per panel, defaults off, and never applies in Dock.

The feature is deliberately a separate phase. Stereo Map first ships with its own
independent frequency range; linked navigation does not block the meter.

## Goals

- Make cross-panel inspection of the same frequency region one action.
- Preserve existing independent-range workflows by default.
- Support Spectrum, Spectrogram, and Stereo Map with one numeric viewport.
- Persist link membership and shared range in Workspace state and presets.
- Make join/leave transitions atomic and avoid transient inconsistent frames.
- Keep Dock frequency controls fully independent.

## Non-goals

- Forcing all frequency panels to share a range.
- Supporting multiple named or colored link groups.
- Linking Hover markers or crosshairs.
- Linking dB, normalized, time, or amplitude axes.
- Adding the feature to Dock Editor or Dock chart gestures.
- Moving the existing shared time viewport into Workspace state.
- Changing DSP analysis requests or history keys.

## Current behavior

Frequency ranges are per-panel controls:

- Spectrum: `spectrumXMinFreq` / `spectrumXMaxFreq`.
- Spectrogram: `spectrogramYMinFreq` / `spectrogramYMaxFreq`.
- Stereo Map: its local X range from the preceding phase.

The main history viewport is shared Session runtime state, not persisted Workspace
state. Dock has a separate live-only shared time window. Neither is a direct model
for this feature because frequency ranges are already persisted display controls.

`frequencyViewport` therefore becomes the first persisted Workspace-level shared
chart viewport.

## State model

Add a Workspace-level field:

```js
frequencyViewport: {
  minHz: 20,
  maxHz: 20000,
}
```

Add one per-instance control to eligible Workspace panels:

```js
linkFrequencyRange: false;
```

The shared viewport exists even when no panel is linked, but is inactive. Whether a
linked group currently exists is derived from eligible panels and their normalized
controls; no separate `enabled` flag is persisted.

Dock controls do not contain `linkFrequencyRange` and never read
`frequencyViewport`.

## Range invariants

One normalization function is authoritative for local and shared frequency ranges:

- absolute bounds: 20 Hz to 20 kHz;
- logarithmic range;
- minimum span: one octave;
- finite ascending values only;
- values clamp to the current source's supported upper frequency at render time
  without mutating the persisted range solely because a lower-rate source is open.

Source-aware render clamping preserves a usable span:

1. `effectiveMax = min(persistedMax, supportedMax)`;
2. when `supportedMax >= 40 Hz`, lower `effectiveMin` as needed so
   `effectiveMin <= effectiveMax / 2`, while keeping it at or above 20 Hz;
3. when `20 Hz < supportedMax < 40 Hz`, use the only available sub-octave range
   `[20 Hz, supportedMax]`;
4. when `supportedMax <= 20 Hz`, show the existing no-frequency-data state.

For example, a persisted 10–20 kHz range on a source capped at 8 kHz renders as
4–8 kHz rather than collapsing to 8–8 kHz. This render-only adjustment never mutates
the persisted shared viewport.

Spectrum, Spectrogram, and Stereo Map must not implement slightly different shared
range clamps.

## Link transitions

### Joining

Joining is one atomic Workspace action.

- If at least one other eligible panel is linked, the joining panel immediately
  renders the existing shared viewport.
- If no other panel is linked, the joining panel's current local range initializes
  `frequencyViewport`, then the panel becomes linked.

The persisted local range remains dormant while linked. It is not continuously
overwritten.

A later join may intentionally jump from that panel's local range to the existing
group range. The transition is atomic, so there is no intermediate frame in which
membership and effective range disagree.

### Leaving

Leaving is also atomic:

1. copy the current shared viewport into that panel's local range fields;
2. set `linkFrequencyRange` to false.

The panel therefore looks unchanged immediately after unlinking and can diverge on
its next interaction.

### Last linked panel

Deleting or unlinking the last participant leaves the dormant shared value in state.
The next first participant still initializes the shared viewport from its own local
range, so stale dormant state is never unexpectedly revived.

## Linked interaction

An eligible panel resolves its effective range as:

```text
linked   -> workspace.frequencyViewport
unlinked -> panel's local frequency range
```

While linked, all frequency-range mutations update the shared viewport:

- wheel zoom;
- drag pan;
- axis-track interaction;
- Panel Settings range input;
- axis reset.

All linked panels rerender from the same normalized state:

- Spectrum maps it to X.
- Spectrogram maps it to frequency Y.
- Stereo Map maps it to X.

Axis orientation does not change the numeric direction: `minHz` is always the lower
frequency and `maxHz` the higher frequency.

Reset from any linked panel resets the shared range to 20 Hz–20 kHz and therefore
resets every participant. Y/dB ranges remain local and unaffected.

## UI

Eligible Workspace panel settings add:

```text
Link frequency range  [toggle]
```

Rules:

- default off for new and migrated panels;
- wording and toggle primitive are identical across all three panel types;
- no global toolbar control;
- no link-group name or color;
- Dock Editor does not show the setting;
- help text explains that only the frequency range is shared.

Chart interactions require no special linked-mode cursor or overlay. The synchronized
motion is the feedback.

## Persistence and presets

Persist:

- `workspace.frequencyViewport`;
- each eligible panel's `linkFrequencyRange`;
- every panel's dormant local range.

Workspace presets capture and restore all three.

Preset application normalizes the whole state before publishing it, so linked panels
never render one frame with incompatible local/shared ranges. A preset with linked
members uses its saved shared viewport. A preset with no linked members retains its
saved local ranges.

## Migration

Old Workspace and preset payloads have no shared viewport or link field.
Normalization supplies:

```text
frequencyViewport = 20 Hz–20 kHz
linkFrequencyRange = false
```

Existing local frequency ranges remain untouched. Upgrading therefore produces no
visual or interaction change until the user explicitly links a panel.

Unknown/removed panels do not count as linked participants.

## Reducer and ownership

Workspace state owns the feature. Use semantic reducer actions rather than panel
components coordinating multiple writes:

- set shared frequency viewport;
- join linked frequency viewport;
- leave linked frequency viewport.

Each action normalizes its inputs and performs all related field changes atomically.
Panel components receive:

- effective frequency range;
- linked state;
- an update callback that targets local or shared state correctly.

This keeps Spectrum/Spectrogram/Stereo Map rendering unaware of persistence details
and prevents partially applied join/unlink frames.

## Analysis, history, and snapshot boundaries

Frequency viewport is display-only:

- it is excluded from Spectrum and Stereo Map analysis request keys;
- changing it does not warm or reset DSP;
- it does not create history gaps;
- it does not alter snapshot selection or source rows;
- it does not affect the Energy gate, which evaluates the complete grid;
- it does not change File versus Live timing.

Hover markers remain panel-local and are not synchronized.

## Dock boundary

Dock completely screens out this feature:

- Dock Spectrum, Spectrogram, and Stereo Map always use Dock-owned local ranges;
- Dock Editor has no link toggle;
- Workspace viewport updates never mutate Dock controls;
- Dock range changes never mutate Workspace state.

This follows the existing normal/Dock display-control ownership boundary.

## Edge cases

- Joining with an invalid legacy local range uses the normalized local range.
- A linked panel whose source temporarily has a lower Nyquist renders a clamped view
  with the source-aware rule above but does not shrink the persisted group for all
  other panels.
- Removing a linked panel leaves other participants unchanged.
- Removing the final participant leaves dormant shared state as described above.
- Adding a new eligible panel starts unlinked even if a linked group exists.
- Duplicate Spectrum/Stereo Map instances may mix linked and unlinked behavior.
- Fullscreen/focus/compact layout changes do not affect membership.
- Clear, Stop, source changes, and history retention changes do not affect membership.

## Testing

### State and normalization

- default and legacy Workspace normalization;
- shared range clamp and minimum octave;
- first join initializes from local;
- later join adopts shared;
- leave copies shared to local;
- deleting the last participant and later joining ignores stale dormant state;
- unknown panels do not count as participants.

### Panel interaction

- Spectrum X zoom/pan/settings/reset update shared state when linked.
- Spectrogram frequency Y interaction updates the same state.
- Stereo Map X interaction updates the same state.
- Unlinked instances keep updating only their local controls.
- dB/Y ranges remain independent.
- sample-rate render clamping preserves the specified span where possible and does
  not mutate persisted state.

### Persistence

- Workspace store round trip;
- preset capture/apply;
- old preset migration;
- atomic preset application with linked participants.

### Dock

- no Dock control schema contains the link field;
- Dock Editor does not render the toggle;
- Dock and Workspace frequency ranges remain independent in both directions.

### Regression

- viewport changes do not alter analysis request keys;
- viewport changes do not create history or snapshot gaps;
- existing Workspaces with custom Spectrum/Spectrogram ranges render unchanged after
  migration;
- `npm run check` passes.

## Acceptance criteria

- Linking is opt-in and defaults off for every Workspace panel.
- Spectrum X, Spectrogram frequency Y, and Stereo Map X share one normalized range.
- First join and leave preserve the panel's visible range; a later join atomically
  adopts the existing group range.
- Linked interactions and settings changes update every participant.
- Local ranges remain independently usable after unlinking.
- Shared viewport and link membership survive restart and preset round trips.
- Existing Workspace/preset payloads migrate without behavioral change.
- Dock contains no link UI or shared-state coupling.
- Analysis keys, history rows, snapshot selection, and DSP remain unchanged.
