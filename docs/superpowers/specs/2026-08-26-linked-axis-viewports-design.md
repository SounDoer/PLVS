# Linked Axis Viewports — Design

**Date:** 2026-08-26
**Status:** Owner-reviewed, ready to plan
**Supersedes:** `docs/superpowers/specs/2026-07-25-linked-frequency-viewport-design.md`

## Summary

Panels that show the same quantity on an axis share one viewport for it by default, and
each panel can opt out. Frequency covers Spectrum's X, Spectrogram's frequency Y and
Stereo Map's X. Time covers Loudness, Spectrogram and Waveform. Membership and the shared
value are persisted and captured by presets. Dock is screened out entirely.

## What changed since the 2026-07-25 draft

The earlier draft covered frequency only, defaulted to unlinked, and placed the control on
its own settings row. Owner review changed four things:

- **Linking defaults to on.** The draft's argument for defaulting off was that upgrading
  should produce no visible change. The owner accepted the upgrade-time change instead:
  synchronized navigation is the behaviour most users want, and an opt-out they never find
  is worse than one they never need. No migration exemption — existing panels link too.
- **Time is in scope.** The mechanism is defined over an axis *kind*, not over frequency,
  so a future numeric axis joins by adding a descriptor rather than a feature.
- **The control lives on the range row.** A link toggle occupies the `action` slot of the
  `SettingsRow` for the range it governs, rather than adding a row of its own. Spectrogram
  carries two, one per axis, and neither costs a row in a panel that already has nine.
- **Source-aware clamping is out of scope.** The draft folded a render-time clamp against
  the source's supported maximum into this feature. That capability does not exist today
  for local ranges either — `supportedMax`, `nyquist` and `sampleRate` appear nowhere in
  the three frequency panels — so it is an independent missing feature, tracked separately.
  Time's own dynamic maximum is different: it already exists and must be honoured.

## Goals

- Make cross-panel inspection of the same region one action, by default.
- Let any panel leave a group without affecting the others.
- Express frequency and time through one mechanism, and admit future axes the same way.
- Persist membership and shared values in Workspace state and presets.
- Make join and leave atomic, with no frame where membership and effective range disagree.
- Keep Dock viewports fully independent.

## Non-goals

- Linking dB, normalized or amplitude axes.
- Multiple named or coloured link groups.
- Linking hover markers or crosshairs.
- Splitting `selectedOffset` per panel. See "The selection stays global".
- Adding the control to Dock Editor or Dock chart gestures.
- Changing DSP analysis requests or history keys.

## Axis kinds

A linkable axis kind is described once:

```js
{
  id: "frequency",
  members: ["spectrum", "spectrogram", "stereo-map"],
  // Orientation is per member and does not affect grouping.
  scale: "log",
  absMin: 20,
  absMax: 20000,
  minSpan: 1,
}
```

Grouping is by **quantity, not orientation**. Spectrogram's frequency axis is vertical and
still belongs to the frequency group: reading a harmonic off the spectrogram and checking
its level on the spectrum is the case this feature exists for. Orientation-based grouping
was considered and rejected, because it would leave Spectrogram — the only vertical
frequency axis — with no group at all.

The numeric direction is orientation-independent: the lower value is always the lower
frequency or the earlier time, whichever end of the rail it renders at.

## The two kinds are not symmetric

They look alike to a user and differ sharply underneath. The plan's phasing follows from
this, so it is recorded here rather than discovered later.

| | Frequency | Time |
| --- | --- | --- |
| Where the value lives | `panelControlsById`, per instance | one `useState` in `useLoudnessHistory` |
| Persisted | yes | no |
| Row in panel settings | `Frequency Range` | none |
| Per-panel values | already supported | do not exist |
| Bounds | fixed 20 Hz–20 kHz | dynamic: file duration, retention setting |

Frequency linking **merges** three existing local values into one shared value. Time
linking **splits** one global value into per-panel values — and that global is not a lone
number but a cluster computed once in `App.jsx` and broadcast through one context:
`clampedWindowSec`, `effectiveOffsetSec`, `effectiveOffsetSamples`, `visibleSamples`,
`historyTimeTicks`, `historyTimeAxisHandlers`, `historyTimeAxisActive`, the four
`onHistory*` pointer handlers, and the HUD trio. Localizing time moves all of it into each
timeline panel instance.

## State model

Workspace-level:

```js
axisViewports: {
  frequency: { min: 20, max: 20000 },
  time: { windowSec: 30, offsetSec: 0 },
}
```

Per panel instance, one membership flag per axis kind the panel participates in:

```js
linkFrequencyViewport: true,
linkTimeViewport: true,
```

A shared viewport exists whether or not anyone is linked; participation is derived from
eligible panels and their normalized controls, so no separate enabled flag is persisted.

Dock controls contain neither flag and never read `axisViewports`.

## Link transitions

**Joining** is one atomic Workspace action. If another eligible panel is already linked,
the joining panel adopts the group's viewport immediately. If none is, the joining panel's
local value initializes the shared one. The dormant local value is preserved, not
continuously overwritten.

**Leaving** is atomic in the other direction: copy the shared viewport into the panel's
local fields, then clear the flag. The panel looks unchanged at the moment it unlinks and
diverges only on its next interaction.

Deleting or unlinking the last participant leaves the shared value dormant. The next first
participant re-initializes it from its own local value, so stale dormant state is never
revived.

## Linked interaction

An eligible panel resolves its effective range as `linked -> shared`, `unlinked -> local`.
While linked, every mutation targets the shared value: wheel zoom, drag pan, axis rail
gestures, the settings range input, and axis reset.

Reset from any linked panel resets the shared value and therefore every participant. This
is a deliberate widening of a gesture that is panel-local today — double-clicking an axis
currently affects one panel and will affect the group.

## UI

The range row carries the toggle in its `action` slot:

```text
Frequency Range  [link]    [20] – [20k]
Time Range       [link]    [30] – [0]
```

Rules:

- default on, for new and existing panels;
- identical wording, icon and placement across every panel and axis kind;
- no global toolbar control, no group name or colour;
- Dock Editor does not show it;
- the tooltip says which axis is shared, and with which panels.

`SettingsRow` renders `action` beside the label in a `max-content` column, so the toggle
must hold its width in both states for the same reason `SettingsResetButton` renders
`invisible` rather than unmounting: a control that comes and goes resizes the label column
and shifts the input beside it.

### The time range row reads the rail, not the model

Time's underlying state is a window length and an offset, and its rail runs in opposite
directions in the two source modes — `buildHistoryTimeAxisLabels` counts down from the
left (`30s -> 0s`, time ago) while `buildMediaTimeAxisLabels` counts up (`0s -> 30s`,
absolute media time).

The two inputs therefore mean **the value at the left end of the rail and the value at the
right end**, matching whatever the axis is currently showing:

- live: `[30] – [0]`
- file: `[0] – [30]`

No units and no negative numbers, consistent with `[20] – [20k]` on the frequency row. A
user copies what the axis shows and never has to know which quantity the model stores.

## Range invariants

One normalization function is authoritative per axis kind, for both local and shared
values. Frequency: 20 Hz–20 kHz, logarithmic, minimum one octave, finite and ascending.
Time: linear seconds, offset at or after zero, window clamped at render time against the
current source — `fileMaxWindowSec` for files, `historyMaxWindowSec` for live, both of
which change without the persisted value changing.

Render-time clamping never mutates a persisted value. Spectrum, Spectrogram, Stereo Map
and the timeline panels must not each implement a slightly different clamp.

## The selection stays global

`selectedOffset` is read by all seven panels, including Spectrum, Stereo Map and
Vectorscope, which have no time axis. It answers "which moment is every panel showing",
and that shared answer is the app's core model. Unlinking time changes which window a
panel displays, never which moment it reports.

The consequence is visible and has to be designed for: with unlinked time windows, a
selection made in one panel can fall outside another panel's window. The selection line is
then off-screen there while the spectral panels still show that moment. Phase 3 needs an
edge indicator for a selection outside the visible window; `TimelineLatestEdgeHint` is the
existing precedent.

## Persistence and presets

Persist `workspace.axisViewports`, each eligible panel's membership flags, and every
panel's dormant local values. Presets capture and restore all three, and preset
application normalizes the whole state before publishing it so linked panels never render
one frame with incompatible local and shared values.

Old payloads have no shared viewport or flags. Normalization supplies the defaults, with
membership on. Unknown or removed panels do not count as participants.

## Reducer and ownership

Workspace state owns the feature through semantic actions — set shared viewport, join,
leave — each normalizing its inputs and performing all related field changes atomically.
Panels receive an effective range, a linked flag, and an update callback that already
targets the right place. Panel components stay unaware of persistence.

## Boundaries

Viewports are display-only: excluded from analysis request keys, they do not warm or reset
DSP, do not create history gaps, do not alter snapshot selection or source rows, do not
affect the Energy gate, and do not change File versus Live timing.

Dock keeps Dock-owned local viewports in every panel, has no toggle, and neither reads nor
writes Workspace viewport state.

## Phasing

Localization and the toggle are two halves of one change and are not split: a local value
nothing can diverge from is dead code, and a toggle with no local value to fall back on
cannot work. Frequency needs no localization phase because its values are already local.

1. **Time Range in panel settings.** The row and its inputs, driving the existing shared
   value. Standalone value: the time window can only be set by gesture today.
2. **The linking mechanism, with frequency as its first axis kind.**
3. **Time localization and linking**, in one change, including the off-window selection
   indicator.

## Testing

Per phase, and in addition to the usual state, normalization and persistence coverage:

- first join initializes from local, later join adopts shared, leave copies shared to local;
- deleting the last participant and re-joining ignores stale dormant state;
- an unlinked instance keeps updating only its local value while a linked sibling moves;
- dB and normalized axes stay independent throughout;
- the time row reads left-to-right in both source modes;
- render clamping preserves the requested span where possible and never writes back;
- Dock panels are unaffected by every Workspace viewport action.
