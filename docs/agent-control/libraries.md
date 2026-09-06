# Library Transfer

Status: Approved design contract

Library Transfer shares the three libraries a PLVS installation accumulates — Presets, Themes, and
Loudness Profiles — as pack files, using the same pack format, merge rules, and persistence paths as
the GUI's per-library Export and Import rows. It owns sharing only. Creating, editing, renaming, and
deleting entries belong to their own command families; Theme Control and Loudness Profile Control do
not exist yet.

## Commands

```powershell
npm run desktop:control -- preset export --all --json
npm run desktop:control -- preset export --ids preset-1,preset-2 --json
npm run desktop:control -- preset import <file|-> --expected-revision 12 --json
npm run desktop:control -- theme list --json
npm run desktop:control -- theme export --all --json --out themes.plvstheme
npm run desktop:control -- theme import <file|-> --expected-revision 12 --json
npm run desktop:control -- loudness-profile list --json
npm run desktop:control -- loudness-profile export --all --json
npm run desktop:control -- loudness-profile import <file|-> --expected-revision 12 --json
```

- `list` returns `{ id, name }` summaries of the library.
- `export` produces a pack document for the whole library or a chosen subset.
- `import` merges a pack document into the library.

`preset list` is Preset Control's, not this family's: it returns the same summaries plus `activeId`
and `dirty`, and is documented in [`presets.md`](presets.md). There is no `preset list` here, and no
`theme describe` or `loudness-profile describe` in the first version.

## Vocabulary

Each library names itself differently on every surface it appears on. None of these can be derived
from another, and the last column contains a trap.

| Library          | CLI word           | Wire method         | `list` / `state` key | Pack `kind`     | File extension  | `plan` field |
| ---------------- | ------------------ | ------------------- | -------------------- | --------------- | --------------- | ------------ |
| Presets          | `preset`           | `preset.*`          | `presets`            | `preset-pack`   | `.plvspreset`   | `items`      |
| Themes           | `theme`            | `theme.*`           | `themes`             | `theme-pack`    | `.plvstheme`    | `items`      |
| Loudness Profile | `loudness-profile` | `loudnessProfile.*` | `profiles`           | `loudness-pack` | `.plvsloudness` | `items`      |

Every library's own entries appear in `plan.items`. `plan.loudnessProfiles` is **not** the Loudness
Profile library's plan: it is the plan for the profiles a Preset pack bundles, so it is always an
empty array for a `loudnessProfile.import` and is only ever populated by `preset.import`. The field
whose name suggests otherwise is the one that will be read wrongly.

## Listing

`theme.list` reports the custom Theme library only. Built-in themes are not library entries, cannot
be exported, and are already enumerated as Appearance choices by `settings describe`; this family
does not restate them.

`loudnessProfile.list` additionally reports `activeId`, the current selection. It is null for Off
and also null when the selection points at a profile the library no longer holds. This family
reports it and never writes it.

```json
{ "revision": 13, "profiles": [{ "id": "p-1", "name": "EBU R128" }], "activeId": "p-1" }
```

`activeId` does not participate in the revision. The revision tracks each library's ids and names
only, so a user switching the active profile in the GUI changes `activeId` while the revision stays
put. `activeId` therefore cannot be guarded with `--expected-revision`, and `app.inspect` has always
reported the Preset relationship on the same terms.

## Export

Export is a read. It takes no `--expected-revision`, accepts no `--dry-run`, does not increment the
revision, and writes no persistence.

```json
{
  "revision": 13,
  "pack": {
    "app": "PLVS",
    "kind": "theme-pack",
    "version": 1,
    "exportedAt": "2026-09-06T00:00:00Z",
    "items": []
  }
}
```

`--all` and `--ids` are mutually exclusive on the CLI and exactly one is required. On the wire the
whole-library form is the **absence** of `ids`, not `ids: null`: the parameter validator accepts
only a non-empty array of non-empty strings, so `"ids": null` and `"ids": []` both fail with
`invalidParams`. CLI callers never meet this; anyone writing JSON-RPC by hand meets it first.

`--ids` is deliberately lenient about the shell's habits, and silently so. Segments are trimmed,
empty segments are dropped, and a duplicated id exports one copy. A value that trims to nothing at
all is an error. An id containing a comma cannot be expressed by this flag.

An id in `--ids` that is not in the library fails with `presetNotFound`, `themeNotFound`, or
`loudnessProfileNotFound`, whose details list every missing id at once. It does not export the
subset that matched. The GUI cannot produce an unknown id because it exports from checkboxes, so
this is a CLI-only failure mode and is explicit rather than repaired.

A preset pack additionally bundles the Loudness Profiles its exported Presets refer to, exactly as
the GUI does; the rule lives in `src/transfer/collectPackItems.js` and is shared by both callers.

### `--out`

`--out <file>` **moves** the pack out of the envelope: Rust writes the pretty-printed document plus
a trailing newline to that path, then removes `result.pack` and inserts `result.out`. The two never
appear together, so a script can tell which it got without inspecting sizes. This is not the tee
behaviour of `doctor --out`; see [`../cli.md`](../cli.md#output-files).

The frontend performs no file IO for these commands. The path is resolved by the CLI, relative to
the caller's working directory, not the app's.

A write failure is reported three ways at once, and the combination is unusual:

- one line on stderr, `Unable to write the pack to <path>: <reason>`;
- process exit code 1;
- a success envelope on stdout, `ok: true`, whose `result` still carries `pack`.

The swap happens only after the bytes reach disk, so a caller that hits a full disk or an unwritable
directory can still recover the export from stdout instead of re-running the command. Note that this
is exit ≠ 0 with `ok: true`, which the rest of the `app` family does not do; `doctor` sets the
precedent but nothing carries `doctor`'s rules over to `app` on its own.

## Import

Import is merge-only and append-only, inherited from the GUI rather than restated here: nothing
local is overwritten, nothing is deleted, and no selection moves — `active`, `activeId`, `dirty`,
and the active theme are left exactly as they were. The rules live in
`src/transfer/mergeIntoLibrary.js` and `src/transfer/libraryAdapters.js`.

The input is a whole pack document, read from a file or `-` (stdin), the same way `workspace apply`
and `preset reorder` take documents. `--expected-revision` is required and `--dry-run` is supported.

```json
{
  "dryRun": false,
  "revision": 14,
  "changed": true,
  "warnings": [],
  "plan": {
    "items": [
      { "sourceId": "t-1", "finalId": "t-1", "name": "Studio", "disposition": "added" },
      { "sourceId": "t-2", "finalId": "t-9", "name": "Night (2)", "disposition": "duplicated" },
      { "sourceId": "t-3", "finalId": "t-3", "name": "Warm", "disposition": "skipped" }
    ],
    "loudnessProfiles": []
  },
  "state": { "themes": [{ "id": "t-1", "name": "Studio" }] }
}
```

- `disposition` is `added`, `skipped` (same id, identical content), or `duplicated` (same id,
  different content — a fresh id is minted and the name gains a ` (2)` suffix).
- `plan.loudnessProfiles` describes the profiles a Preset pack bundled. See [Vocabulary](#vocabulary).
- `state` reports the resulting library in the same shape that family's `list` returns, so a caller
  does not have to follow a successful import with a `list`. It reports the requested family only:
  a `preset.import` that also added bundled Loudness Profiles reports `presets` and not `profiles`.
- `warnings` is always an empty array today. Nothing populates it. See below.

A dry run is the real code path minus the append, not a parallel simulation: the whole import
decision is computed by a pure function before anything is written. It returns the identical `plan`
and writes nothing.

### Warnings and the silent profile downgrade

`warnings` is present for envelope consistency and is reserved. No import produces one today, and
one case in particular is not reported: when an imported Preset refers to a Loudness Profile the
pack did not bundle, the reference cannot be honoured on this machine and is downgraded to Off. That
is a change to the imported Preset that the caller is not told about, in a field the caller may be
watching. Compare `plan.items` against the pack when the Presets carry profile selections.

### Revision and no-ops

An import that adds at least one entry increments the global revision once, no matter how many
entries it added. It is bumped from the library's own state signature, so a GUI import moves it
identically.

An import whose every item is `skipped` is a successful no-op: `changed: false`, no revision
increment, no persistence write. So is an import whose every item **failed validation** — pack
parsing filters unreadable items silently, matching the GUI, so a corrupted or partly foreign file
reports `changed: false` and an empty plan rather than an error. That is consistent behaviour, not a
defect, but a caller must not read "nothing changed" as "already up to date": compare `plan.items`
against the item count of the file it submitted.

A dry run and a no-op both return the revision from *before* the request, and neither flushes
persistence, because both return before any write exists to persist. The returned revision is never
evidence that state was written.

Import never marks the active Preset dirty. The dirty flag tracks the working scene, and a library
merge changes no scene state.

`app.inspect` is unchanged by this family. It keeps reporting the compact `{ activeId, dirty }`
Preset relationship and gains no Theme or Loudness Profile library; callers use the `list` commands.

## Active editors do not block import

Library import is allowed while the Theme Editor or the Loudness Profile Editor is open. It is not a
scene operation and does not consult the shared blocking-editor guard.

This is the exception to a rule that holds everywhere else in App Control, so it is stated rather
than left to be discovered. The guard exists because scene operations destroy an open draft; an
append-only merge that moves no selection and dirties no Preset cannot. The GUI agrees: the Settings
panel's Import buttons are disabled while a transfer is in flight, never on editor state, so
refusing here would make the CLI stricter than the button it mirrors for no protective gain.

## Errors

This family reuses the existing envelope and codes and adds two:

- `presetNotFound`, `themeNotFound`, `loudnessProfileNotFound` — an id in `--ids` is not in that
  library. `details.missingIds` lists all of them. Exit code 3.
- `invalidPack` — the document is not a valid pack for this family. The message is the one written
  for a person who received a shared file, and distinguishes "not a PLVS file", a whole
  configuration file, another library's file, a missing version, and a file made by a newer version
  of PLVS. It carries no `details`. Exit code 3.

`revisionConflict`, `persistenceFailed`, and `commandFailed` behave as they do everywhere else. A
`persistenceFailed` after the library committed reports `stateCommitted: true` and the resulting
revision; the caller must inspect again rather than resubmit.
