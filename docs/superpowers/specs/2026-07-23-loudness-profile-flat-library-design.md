# Loudness Profile flat library — design

**Date:** 2026-07-23  
**Status:** Draft  
**Supersedes (product behaviour):** the built-in / user profile split in
`2026-07-19-loudness-profile-design.md` and
`2026-07-20-loudness-profile-editor-design.md`.

## Summary

Replace the standards-oriented built-in catalogue with one flat, mutable
Loudness Profile library. PLVS should expose the parameters it evaluates and
encourage users to build rules for their own work instead of presenting
broadcast or streaming standards as the primary workflow.

`Off` remains the only special option. A fresh configuration contains one
ordinary starter profile named `I −23 ±0.5 · TP ≤ −1`; it has exactly the same
edit and delete capabilities as every profile the user creates.

This change is intentionally clean rather than migratory. Loudness Profile has
not shipped publicly, so the old built-in selection model does not need
compatibility handling.

## Motivation

- Game-audio production does not generally benefit from a menu dominated by
  broadcast and streaming delivery standards.
- Standard names hide the actual checks. Parameter-led names make the profile's
  intent visible without implying certification.
- The rule editor is now strong enough to be the product's differentiator.
  Read-only built-ins direct attention away from it.
- One mutable library is easier to understand than built-in, duplicated, and
  user-owned variants of the same document.

## Product model

### Selection

Exactly one of:

| Selection | Meaning |
| --- | --- |
| `off` | No profile evaluation, status colour, missing-stat request, or reference line. |
| `profile:<id>` | Resolve one document from the mutable profile library. |

The default selection on first launch and after Reset Configuration is `off`.

### Flat mutable library

Every library entry has the same logical shape:

```text
{
  id,
  name,
  referenceLufs,
  rules
}
```

There is no `kind`, `basedOn`, built-in catalogue, read-only entry, or duplicate
workflow. Every entry can be selected, edited, renamed, and deleted.

Profile names are user-maintained labels. Editing rules never changes a name
automatically, and duplicate names are allowed.

An empty library is valid. The starter profile is seeded only when a
configuration is first created or explicitly reset; normalization must not
recreate it after the user deliberately deletes it.

### Starter profile

A fresh or reset configuration contains one ordinary profile:

| Field | Value |
| --- | --- |
| Name | `I −23 ±0.5 · TP ≤ −1` |
| Reference | `−23 LUFS` |
| Integrated lower bound | `< −23.5 LUFS` → Fail |
| Integrated upper bound | `> −22.5 LUFS` → Fail |
| True Peak Max | `> −1 dBTP` → Fail |

The compact name describes acceptable values, while the rule engine continues
to store breach predicates. The Integrated band and True Peak rule both use
`Fail` severity.

### New profiles

`New profile` opens a draft with:

- name `Untitled`,
- `referenceLufs: null`,
- no rules.

The editor opens its name input with `Untitled` selected, so typing replaces the
default without another click. It can also be saved immediately. A profile with
no reference and no rules is valid and inert: it draws no reference line, judges
no metric, and requests no missing Stats rows. It remains selectable and
editable.

## Popover and editor

The popover is one flat list:

1. `Off`
2. every profile in library order
3. `New profile`

Remove the `Built-in` and `Yours` headings. Do not show a separate right-hand
reference value on any row; this keeps all entries visually equal and avoids
duplicating the starter profile's name.

Every profile row exposes the same `Edit rules` and `Delete` actions. Editing
keeps the existing live-preview behaviour.

Deletion uses the existing Presets `InlineConfirm` interaction. The first click
on the trash action replaces the row actions with cancel (`×`) and confirm
(`✓`). It shows no dialog or explanatory copy.

## Deletion and Presets

Layout Presets continue to store only the active profile selection, not a copy
of the profile document.

Confirming deletion is one coordinated operation:

1. remove the profile from the library,
2. switch the active selection to `off` if it referenced that profile,
3. rewrite every Layout Preset that referenced that profile to `off`.

The cascade is silent but deterministic. Restoring or recreating a profile later
must not reconnect old Presets to it.

When imported or malformed data contains an active or Preset selection whose
profile ID is absent from the library, normalize that selection to `off`.

## Configuration lifecycle

Loudness Profiles remain part of Configuration import and export.

Reset Configuration keeps its existing whole-configuration meaning. It clears
the profile library together with the other reset domains, recreates only the
starter profile described above, and sets the active Loudness Profile to `off`.

No migration is required for `builtin:<id>`, `user:<id>`, `kind`, or `basedOn`.
The implementation and tests may remove those shapes outright.

## Documentation

Update `docs/prd.md` so the current product contract no longer promises EBU,
ATSC, or Streaming built-ins. Mark the earlier Loudness Profile design documents
as superseded and point them here; keep their historical decisions intact.

Keep `docs/loudness-references.md` as historical provenance. Add a prominent
legacy notice at its beginning stating that:

- it documents sources used by the former built-in catalogue,
- those standards are no longer provided or recommended as product presets,
- PLVS moved to transparent parameters and user-defined rules, particularly for
  workflows such as game audio where broadcast delivery presets are often not
  useful,
- the page is retained only for historical parameter traceability.

The measurement engine remains based on ITU-R BS.1770. Removing named standards
from the profile catalogue does not change measurement behaviour.

## Verification

Tests should establish:

- first launch selects `Off` and seeds exactly one starter profile,
- the popover is flat and contains no built-in/user grouping,
- every profile row supports edit and inline-confirm delete,
- cancelling inline delete preserves the profile,
- confirming deletion removes the profile,
- deleting the active profile switches to `Off`,
- deleting a profile rewrites every referencing Preset to `Off`,
- `New profile` starts as `Untitled` with no reference or rules,
- a profile with no reference or rules can be saved and remains inert,
- deleting the starter profile does not cause normalization to recreate it,
- Reset Configuration restores only the starter profile and selects `Off`,
- dangling selections from imported or malformed data normalize to `Off`,
- Configuration import/export round-trips the flat library.

Assert visible behaviour and persisted snapshots rather than private React
state.

## Locked decisions

1. Use one flat, mutable library; there are no built-in or user categories.
2. `Off` is the only immutable special option and is the default selection.
3. Seed one ordinary `I −23 ±0.5 · TP ≤ −1` profile with Fail rules.
4. All profiles, including the seeded profile, can be edited and deleted.
5. New profiles start as `Untitled` with no reference and no rules.
6. Profiles with no reference or rules are valid, and duplicate names are
   allowed.
7. Names never update automatically from rule changes.
8. Deletion uses Presets-style inline `×` / `✓` confirmation with no message.
9. Deleting a profile cascades active and Preset references to `Off`.
10. Reset Configuration clears the library, recreates the starter, and selects
    `Off`.
11. No migration is required because the feature has not shipped publicly.
12. `docs/loudness-references.md` remains as a prominently marked legacy
    bibliography.
