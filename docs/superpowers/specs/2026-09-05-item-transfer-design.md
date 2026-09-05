# Per-Item Import / Export for Loudness Profiles, Presets and Themes

Date: 2026-09-05
Status: Approved design, not yet implemented

## Problem

PLVS can export and import the whole configuration (`.plvsconfig`, `src/persistence/profile.js`),
but there is no way to hand one theme, one layout preset or one loudness profile to somebody else.
The whole-configuration file is the wrong tool for that: importing it replaces every domain and
relaunches the app, so a recipient who wants one theme loses their entire setup to get it.

## Scope

**Sharing only.** The feature exists so a user can send an item to another user, who adds it to
their library. Backup and machine migration stay with the existing `.plvsconfig` flow and are
explicitly out of scope.

Consequences of that single decision, which the rest of this design assumes:

- Import is **merge-only**. Nothing local is ever overwritten or deleted.
- Import never relaunches; it touches library state only, never startup state (window bounds,
  capture device, shortcuts).
- Import never activates what it imported. Items land in the library; the user selects them.

## Current shape of the three libraries

They are not symmetric, and this design does not make them symmetric:

| Library | Lives in | Container |
| --- | --- | --- |
| Loudness profiles | `settingsStore.loudnessProfiles` | `{ active, profiles: [doc] }` |
| Presets | `presetsStore` | `{ list: [preset], activeId, dirty }` |
| Themes | `themesStore` | `{ themes: {id: doc}, order: [id] }` |

The only cross-reference is **preset -> loudness profile**: a preset snapshot carries
`loudnessProfileActive`, a selection id of the form `profile:<id>` (or `off`). Presets do **not**
carry a theme. Theme documents (`version: 2`) are self-contained.

There are no built-in loudness profiles — everything except `off` is a user-library entry, seeded
from `createStarterProfile`. So a shared preset's profile reference is always dangling on the
recipient's machine unless the profile travels with it.

### Deliberately not doing: extracting a `plvs:loudness` domain

Considered and rejected for this change. It would touch `persistence/index.js`, `profileShape.js`,
`src-tauri/src/profile.rs`, `src-tauri/src/lib.rs`, the `.plvsconfig` format (existing files carry
the blob under `settings.loudnessProfiles`), and would need a one-shot store migration of every
installed user's hand-written rule sets. What it buys this feature is one line: writing via
`loudnessStore.patch(next)` instead of `settingsStore.patch({ loudnessProfiles: next })`. The real
asymmetry between the three libraries is the container shape above, which a domain split does not
touch — each type needs its own adapter either way. If a future change needs per-domain reset, the
extraction should be its own spec with its own migration plan.

## File format

Three kinds, one envelope, modelled on `src/persistence/profileShape.js`:

```jsonc
{
  "app": "PLVS",
  "kind": "theme-pack" | "preset-pack" | "loudness-pack",
  "version": 1,
  "exportedAt": "2026-09-05T00:00:00.000Z",
  "items": [ /* full documents, per kind */ ],
  "loudnessProfiles": [ /* preset-pack only: the profiles items reference */ ]
}
```

| Kind | Extension | Item shape |
| --- | --- | --- |
| `theme-pack` | `.plvstheme` | a `normalizeThemeDocument`-accepted v2 theme document |
| `preset-pack` | `.plvspreset` | one entry of `presetsStore.list` |
| `loudness-pack` | `.plvsloudness` | `{ id, name, referenceLufs, rules }` |

`items` is an array in all three kinds — the picker supports multi-select within one kind. There is
no cross-kind bundle: each Settings row exports its own kind.

`loudnessProfiles` on a `preset-pack` holds full documents for exactly the profiles the exported
presets reference. This is the one place a file carries a dependency, and the picker shows it.

## Module layout

```
src/transfer/
  packShape.js         envelope + per-kind build/normalize          (mirrors profileShape.js)
  mergeIntoLibrary.js  pure: (librarySnapshot, pack) -> { nextState, plan }
  libraryAdapters.js   per-kind list / lookup-by-id / write-back
  usePackTransfer.js   hook: file dialogs, read/write, status       (mirrors useConfigurationProfileActions.js)
src/components/
  ItemPickerDialog.jsx movable dialog, two modes
```

`mergeIntoLibrary.js` holds the conflict rules and is a **pure function** — it takes a snapshot and
a pack and returns the next state plus a disposition plan. It never touches a store, so the rules
are fully unit-testable without React. `libraryAdapters.js` absorbs the container-shape differences
listed above; `mergeIntoLibrary` never sees whether a library is a map or a list.

## Merge rules

For each incoming item, look it up by id in the target library:

| Case | Action | Plan mark |
| --- | --- | --- |
| id absent | add; if the name collides with a local entry, suffix the name | `added` |
| id present, normalized deep-equal | skip | `skipped` |
| id present, content differs | add as a copy: fresh id, suffixed name | `duplicated` |

Name suffixing appends ` (2)`, incrementing until the name is free within that library. It applies
to the incoming item only; a local entry's name is never changed.

Both sides are normalized before comparison (`normalizeThemeDocument`, `normalizeRuleDocument`, the
preset normalizer) so that field order and defaulted keys cannot make identical content compare as
different.

This makes re-importing the same file idempotent, while an updated version sent by the same author
arrives as a new entry rather than silently doing nothing. Nothing local is lost either way.

**`preset-pack` runs in two stages.** Merge `loudnessProfiles` first under the same three rules,
building an id remap table, then rewrite each preset's `loudnessProfileActive` through it. A
profile that merged as `duplicated` is in the table, so the preset points at that copy rather than
at the recipient's existing entry — the preset should get the rules it was authored against.

`activeId`, `presetsStore.dirty`, `settings.themeId` and `loudnessProfiles.active` are never
modified by an import: nothing about the active scene changes, so nothing has diverged from it.
A theme import appends to `themesStore.order`, which is list membership, not selection.

## UI

### Settings

`SettingsPanel.jsx`'s Configuration section grows to four rows, the three new ones **above** the
existing Configuration row:

```
Loudness Profiles   Export… / Import…
Presets             Export… / Import…
Theme               Export… / Import…
Configuration       Export / Import / Reset      (existing, unchanged)
```

The ellipsis on the new rows is deliberate: they open a dialog rather than going straight to a file
dialog.

### ItemPickerDialog

A Radix `Dialog` with drag via `clampPanelPos`, following `ThemeEditor.jsx`. One component,
parameterized by kind and mode; six instances in practice (3 kinds x 2 modes).

- **pick mode (export)** — the library list with checkboxes, Export at the bottom. In preset mode,
  the loudness profiles referenced by the checked presets appear as read-only "Also included" rows,
  so the side effect is visible before the file is written.
- **review mode (import)** — the parsed file's contents, read-only, each row carrying its planned
  disposition (Add / Already in your library / Import as a copy) plus any bundled profiles.
  Import / Cancel at the bottom. **Nothing is written until Import is pressed.**

Window position is **not** persisted; the dialog opens centred. It is a one-shot operation, unlike
`ThemeEditor`, which stays open across repeated adjustments and stores `settings.themeEditorPos`.

**It is deliberately not registered with `useBlockingEditor`.** It has selection state but no draft:
closing it discards nothing the user authored, and none of its operations are scene operations
(import adds to a library; it does not capture or replace the scene). The AGENTS.md rule about
registering draft-style editors does not apply here, and adding the registration would wrongly
block preset apply and dock entry while the dialog is open.

Empty libraries get an explicit empty state in pick mode rather than a blank list.

### Default file names

Single selection uses the item's name (`Warm.plvstheme`); multi-selection uses a generic name
(`plvs-themes.plvstheme`, `plvs-presets.plvspreset`, `plvs-loudness.plvsloudness`).

## Errors and edges

Parse failures are reported specifically, not as today's blanket `Import failed` — the existing
`useConfigurationProfileActions.js` swallows `ProfileValidationError`'s message in a bare
`catch (_)`. The new import path distinguishes:

- not JSON
- not a PLVS file (`app`/`kind` missing or wrong)
- wrong kind for this row — the message names the right row ("This is a theme file. Import it from
  the Theme row.")
- `version` higher than this build supports

Other behaviours:

- Export calls `flushPersistence()` first, as the existing configuration export does.
- Import does not relaunch.
- Browser mode mirrors the current split: export works via a Blob download, import reports that it
  is available in the desktop app.

## Testing

- `mergeIntoLibrary` — the three dispositions x the three kinds, plus the preset id-remap path
  (including a preset pointing at a `duplicated` profile) and the never-overwrite invariant.
- `packShape` — round-trip, and each rejection case above.
- `libraryAdapters` — write-back into each of the three container shapes.
- `ItemPickerDialog` — both modes, the preset "Also included" rows, and empty state.

Preset snapshots carry numbers that reached the frontend as Rust `f32`. Fixtures must use values
Float32 holds exactly (`Math.fround`, or divisors that are powers of two) — see AGENTS.md.

`npm run check` covers all of this; no capture-layer code is touched, so `smoke:capture` and
`soak:capture` are not implicated.
