# Loudness Profile editor — design

**Date:** 2026-07-20
**Status:** Draft
**Extends:** `docs/superpowers/specs/2026-07-19-loudness-profile-design.md`
**Revises (product behaviour):** that spec's §Popover IA item 2, its
`unsaved-custom` selection, and decisions 5 and 15.

## Summary

Give Loudness Profiles a real editor: a floating panel, modelled on `ThemeEditor`,
where a user picks which metrics a profile watches, sets each rule's numbers, and
sets each rule's breach severity — with the meter previewing the draft live.

Two shapes fall out of that:

- **`unsaved-custom` is deleted.** The scratch pad existed because there was
  nowhere to edit rules. The editor's own draft replaces it, so the selection
  model narrows to `off` | `builtin:<id>` | `user:<id>`.
- **A preview overlay** lets the draft outrank the persisted selection for every
  reader, without writing to disk.

## Motivation

The shipped popover edits one number: `referenceLufs`. Every other rule is frozen
at whatever the catalog authored. A Custom profile is therefore stuck watching
Integrated and True Peak at ±0.5 and −1 forever, and a user who wants to watch
phase or dialogue range has no path at all short of a code change.

The product split we want is by *user*, not by feature:

- Someone who just wants a delivery target picks a built-in and never opens
  anything else.
- Someone with a client spec builds their own profile and needs full control:
  which metrics, what numbers, how hard each breach lands.

The editor has to be invisible to the first user and complete for the second.

## Goals

- Any of the 15 Stats metrics can be watched by a profile.
- Per rule: the numbers, and the breach severity (`fail` | `warn`).
- Live preview — Stats colours, the reference line and the TP Max marker follow
  the draft while editing, against real audio.
- Cancel is total: nothing on disk, nothing in the session, changed.
- One editor for user profiles; built-ins stay read-only, reachable only through
  Duplicate.

## Non-goals

- Editing built-ins in place.
- A System Settings page for profiles (still out, as in the parent spec).
- Editing a profile from the dock.
- Sharing / importing single profiles (the Configuration Profile domain already
  round-trips `plvs:settings` wholesale).
- Per-rule `provisional` and `requiresDialogueCoverage` as user-facing controls.
  They stay catalog-authoring concepts; a duplicate carries them, the editor does
  not show them. Exposing "this conclusion never settles" as a checkbox asks the
  user to reason about something the built-in author already decided.

## Product model

### Selection model narrows

| Selection | Meaning |
| --- | --- |
| `off` | No watched metrics; no colours; no reference line. |
| `builtin:<id>` | Read-only built-in. |
| `user:<id>` | Saved user profile; editable. |

`unsaved-custom` and the persisted `customDraft` slot are gone. There is no
migration: the feature has never shipped, and `normalizeActive` already falls
back to Off for any selection it cannot honour, so a persisted `unsaved-custom`
degrades correctly on its own.

### Every metric declares its own rule shape

The parent spec's `MetricRule.role` is an implementation concept. Users do not
think "I want a limit rule on True Peak", they think "TP must not exceed −1". So
the profile catalog carries a table mapping each Stats metric to the rule shape
it can wear, and the editor never asks the user to choose a role:

| Metric | Unit | Shape | Reading |
| --- | --- | --- | --- |
| Momentary | LUFS | target | should sit at |
| Short-term | LUFS | target | should sit at |
| Integrated | LUFS | target | should sit at |
| Dialogue Integrated | LUFS | target | should sit at |
| Momentary Max | LUFS | limit | ceiling |
| Short-term Max | LUFS | limit | ceiling |
| True Peak Max | dBTP | limit | ceiling |
| Dialogue Coverage | % | limit | floor |
| Correlation | — | limit | floor |
| Short-term Dynamics (PSR) | dB | limit | floor |
| Integrated Dynamics (PLR) | dB | limit | floor |
| Loudness Range | LU | limit | band |
| Dialogue Range | LU | limit | band |
| Dialogue Offset | LU | limit | band |
| Side/Mid | dB | limit | band |

The `limit` role already carries both `min` and `max`, so ceiling / floor / band
are the same shape with different fields left blank. The editor renders a limit
rule as two inputs (`≥` and `≤`) and a target rule as three (`target`, `−`, `+`);
the table's "Reading" column only decides which input gets focus first and what
the row's hint says.

**No default numbers.** Adding a metric adds an empty rule. This is deliberate:
inventing a threshold for Side/Mid or PSR would be exactly the fabricated-standard
behaviour the parent spec exists to avoid. A number the user typed is a number the
user owns.

### An empty rule is a real state

A metric can be watched with nothing filled in yet. That state has to survive,
because the alternative is a row that vanishes when the panel closes.

- `normalizeRule` keeps a rule whose `role` is valid even when it has no numbers,
  instead of returning `null`. Only an unknown role or an unparseable number is
  rejected.
- `loudnessProfileEvaluate` returns `unwatched` for a rule with nothing to compare
  against — an empty rule judges nothing.
- `listMissingPreferredMetrics` skips metrics whose rule has no numbers — an
  empty rule demands nothing, so Show missing does not push rows into Stats for a
  metric the profile is not actually watching yet.

Three modules, one rule: **an empty rule is inert everywhere.**

### Duplicating a built-in drops its descriptor and n/a rules

Built-ins carry `descriptor` and `na` rules (EBU's `lra`, S1's `lra` as n/a) as
authoring annotations: "we deliberately do not judge this". A user profile that
simply does not mention a metric already means the same thing, so carrying them
into a duplicate would leave rules the editor does not show and the user cannot
remove.

Dropping them is behaviourally lossless today: `loudnessStatusValueClass` maps
both `na` and an absent status to the same default class, so `na` and unwatched
already render identically. The parent spec's "tip may say N/A" was never built,
and would not survive user editing anyway.

The two roles stay in the model for built-ins. They are simply not something a
user profile can contain.

## Architecture

### `LoudnessProfileProvider`

`useLoudnessProfile()` is currently instantiated independently by `StatsPanel`,
`DockStats`, `LevelMeterPanel` and `PanelSettingsContent` — four `useState`s, four
subscriptions, four normalize passes per settings change. A draft held in any one
of them is invisible to the other three, which rules out keeping the draft in the
editor component.

A provider replaces the fan-out:

```
App
└─ WorkspaceProvider
   └─ MeterRuntimeProvider
      └─ LoudnessProfileProvider      state: { persisted, draft }
         └─ AppContent
            ├─ StatsPanel          ─┐
            ├─ DockStats            ├─ useLoudnessProfile() reads context
            ├─ LevelMeterPanel      │  document = draft ?? resolveActive(persisted)
            ├─ PanelSettingsContent ┘
            └─ AppSettingsOverlays
               └─ LoudnessProfileEditor   the only writer
```

`dockLayout` is a hook inside `AppContent` and `DockStats` is rendered by it, so
one provider covers both windows' worth of Stats. Consumers keep calling
`useLoudnessProfile()` and keep the return shape they have — the change is where
the state lives, not what the hook looks like.

### The preview overlay

```js
{
  editing: { id: string | null },   // null = new, not yet in the library
  draft: RuleDocument,
  dirty: boolean,
}
```

`document` resolves to `draft ?? resolveActiveDocument(persisted)`. While a draft
exists it outranks the persisted selection for every reader, so Stats colours, the
reference line, the footer and the TP Max marker all follow what the user is
typing, against whatever audio is playing. That is the point: whether
`Correlation ≥ 0` is too strict for this material is not a question anyone can
answer from a form — it is a question the meter answers the moment the row turns.

The draft never reaches `settingsStore`. Two consequences worth stating:

- **Preview cannot dirty a layout preset**, because nothing writes to a store
  until Save.
- **Cancel is `setDraft(null)`.** `ThemeEditor` needs `wasNewRef` and `prevRef`
  because it previews by mutating the real selection and eagerly upserting new
  themes, so cancelling means unwinding side effects. An overlay has no side
  effects to unwind. We take the precedent's shape and skip its compromise.

### Preset divergence narrows

`e7a43bbc` made every profile write mark the active preset dirty. That was right
while the preset snapshot carried `loudnessProfileCustomDraft` — editing the draft
genuinely diverged from the preset.

With `customDraft` gone, the snapshot is `loudnessProfileActive` alone: an id.
Editing a profile's rules therefore does **not** change what the preset holds, and
must stop marking it dirty.

The rule is about the *selection*, not about which function ran, because two
library operations move the selection as a side effect:

- **Marks dirty** — anything that leaves `active` holding a different value:
  `select`, `selectOff`, saving a draft (it selects what it saved), and deleting
  the active profile (it falls back to Off).
- **Does not** — anything that leaves `active` alone: rename, rule edits, saving
  a draft that was already the active profile, deleting a profile that was not
  active.

Implement it as a comparison of `active` before and after the write rather than as
a flag per call site; a per-call-site flag is what produces the two exceptions
above being wrong.

A preset restoring `user:<id>` gets whatever that profile says today, which is the
same contract themes have.

## UI

### Entry

The popover gains a pencil on user rows (beside the existing rename and delete)
and keeps the copy icon on built-ins. Both open the editor; Duplicate opens it on
an unsaved copy. A `New profile` row sits under the Yours group and opens the
editor on a starter draft — Integrated target −23, True Peak max −1, the same two
rules today's default draft carries. A blank editor with no rows is a dead end.

Opening the editor closes the popover.

### The editor panel

Draggable, `ThemeEditor`'s frame, wider than the popover because a rule needs four
columns and a target rule needs five:

```
┌──────────────────────────────────────────────────────────┐
│ ⠿  Edit Loudness Profile                    Save  Cancel │
│                                                          │
│ Name       [ My Show                                   ] │
│ Reference  [ -20 ] LUFS                                  │
│ ──────────────────────────────────────────────────────── │
│ Integrated       target [-20] − [0.5] + [0.5]  [Fail ▾] ⊗│
│ True Peak Max    ≥ [    ]  ≤ [-1.5]            [Fail ▾] ⊗│
│ Correlation      ≥ [ 0  ]  ≤ [    ]            [Warn ▾] ⊗│
│ Side/Mid         ≥ [    ]  ≤ [    ]            [Warn ▾] ⊗│
│                                       ↑ empty: not judged │
│ ──────────────────────────────────────────────────────── │
│ [ + Add metric ▾ ]                                       │
│                                                          │
│ Delivery reference, not a certification.                 │
└──────────────────────────────────────────────────────────┘
```

- **Reference** stays a first-class field and keeps `withReferenceLufs`'s
  behaviour: moving it moves the anchor rule's target with it. In the editor the
  anchor row updates visibly as you type, which makes the coupling legible instead
  of magic. A profile with no target rule at all — every metric a limit — has no
  anchor to move, so Reference only drives the chart line and the footer. That is
  a legitimate profile (a pure ceilings profile), not an error state.
- **Add metric** lists the 15 Stats metrics minus those already present, labelled
  from `STATS_META`.
- **⊗** removes a rule and its `preferredMetricIds` entry.
- Numeric inputs commit on blur or Enter, never per keystroke — the same rule the
  Reference input already follows, for the same reason.
- Severity is a two-item select. `Fail` reads as `signal.bad`, `Warn` as
  `signal.warn`; the parent spec's status→colour table is unchanged.

### Footer reports the profile, not the number

The footer item becomes the active profile's **name**, and still disappears under
Off. It moves up a level: which regime you are monitoring under is the fact worth
a permanent slot, and the reference value is already drawn on the chart as the
line it describes.

```
Device  Realtek…  │  Loudness  EBU R128  │  Preset  My Layout
```

The label is **`Loudness`**, not `Profile`. The parent spec's Naming section
forbids shortening the feature to "Profile" because Configuration Profile already
owns that word, and the footer is the worst place to break that rule: the item
sits directly beside `Preset`, so `Profile  …  Preset  …` reads as two spellings
of one thing. `Loudness Profile` in full is too long for a row of one-word labels.

While a draft is previewing, the footer shows the draft's name — the footer
reports what is in effect, and the draft outranks the selection. A new profile
with an empty name reads `Untitled`, matching `normalizeRuleDocument`'s existing
fallback.

`FOOTER_VALUE` already carries `min-w-0 truncate`, so a long user-authored name
needs no new handling. `App.jsx` stops fanning `referenceLufs` out to `footer`;
it still derives it for the loudness history data, which is its only remaining
consumer.

### Save and Cancel

- **Save** requires a non-empty name; the button is disabled otherwise. It writes
  the draft to `userProfiles` (insert when `editing.id` is null, replace
  otherwise), selects it, and clears the draft.
- **Cancel** clears the draft. If dirty, it asks first — the same
  `InlineConfirm` / discard-dialog pattern `ThemeEditor` uses.
- Closing the app or the panel while dirty is a Cancel.

## Modules

| Module | Responsibility |
| --- | --- |
| `loudnessProfileCatalog.js` | Add the metric→shape table and `createProfileDraft`. Rename `createDefaultCustomDraft`; drop `LOUDNESS_PROFILE_CUSTOM`. |
| `loudnessProfileNormalize.js` | Keep empty rules; drop `customDraft` and the `unsaved-custom` branch. |
| `loudnessProfileEvaluate.js` | Return `unwatched` for a rule with no numbers. |
| `loudnessProfileMissing.js` | Skip metrics whose rule has no numbers. |
| `LoudnessProfileContext.jsx` | New. Owns `{ persisted, draft }`, exposes today's `useLoudnessProfile()` shape plus `beginEdit` / `beginCreate` / `editDraft` / `saveDraft` / `cancelDraft`. |
| `LoudnessProfileEditor.jsx` | New. The panel. Presentational: takes a draft and callbacks. |
| `LoudnessProfilePopover.jsx` | Drop the Custom row, the Save-as field and the Reference input; add the pencil and New profile. |
| `usePresets.js` | Drop `loudnessProfileCustomDraft` from the snapshot. |
| `AppShell.jsx` | Footer item shows the profile name, not the reference value. |

## Testing

Pure cores first, as the parent spec established:

- Metric→shape table covers every id in `STATS_CANONICAL_ORDER` — a metric the
  editor can add but cannot shape would be unreachable.
- Empty rules: survive normalize, evaluate as `unwatched`, are absent from
  missing. One test per module, plus one that round-trips an empty rule through
  persistence.
- Duplicating a built-in drops `descriptor` / `na` and keeps the rest.
- `withReferenceLufs` keeps its existing tests.

Component tests:

- Editing a draft repaints Stats without touching `settingsStore`.
- Cancel restores the previous colours and leaves the library untouched.
- Save inserts a new profile, or replaces an existing one, and selects it.
- Selection changes dirty the active preset; library edits do not.
- The popover no longer offers Custom.
- The footer names the active profile, names a previewing draft instead, and
  disappears under Off.

Assert visible behaviour and store snapshots, not private state shape.

## Risks

- **The provider is the largest structural change.** Four consumers move from
  their own state to shared context. Their code does not change, but their data
  source does, and a wrong provider position silently splits the dock from the
  main window — the exact split-brain the parent spec warns about for Stats. The
  test that catches it is a dock-and-panel-together colour assertion.
- **Live preview against a stale draft.** If the editor is open when a preset is
  applied, the preset changes the selection underneath a draft that outranks it.
  Applying a preset while editing should cancel the draft; specify it, do not
  leave it to discover.
- **15 metrics is a long Add list** in a panel that also has to stay readable.
  Grouping it by family (loudness / peaks / dynamics / dialogue / stereo) is
  cheap and worth doing at implement time.

## Open at implement time (non-blocking)

- Panel width and whether rules scroll past a certain count.
- Whether the Add list groups by family or stays flat.
- Exact discard-confirm copy.
- Whether `New profile` sits in the popover or only inside the editor.
