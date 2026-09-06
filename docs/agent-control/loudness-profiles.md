# Loudness Profile Control

Status: Implemented public contract

Loudness Profile Control owns full-document inspection, authoring, selection, deletion, and
ordering. Pack sharing remains the separate [Library Transfer](libraries.md) contract.

## Commands

```powershell
plvs-cli loudness-profile describe <id> --json
plvs-cli loudness-profile select <id|off> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]
```

The corresponding wire methods are `loudnessProfile.describe`, `loudnessProfile.select`,
`loudnessProfile.create`, `loudnessProfile.update`, `loudnessProfile.rename`,
`loudnessProfile.delete`, and `loudnessProfile.reorder`.

## Authoring document

`create` and `update` read a complete UTF-8 JSON document from a file or `-` for stdin:

```json
{
  "name": "EBU R128",
  "referenceLufs": -23,
  "rules": [
    { "metricId": "integrated", "op": ">", "value": -22.5, "severity": "fail" },
    { "metricId": "truePeak", "op": ">", "value": -1, "severity": "warn" }
  ]
}
```

The document has no `id`: creation mints one, while update takes its target from the command line.
It must be a plain object with exactly `name`, `referenceLufs`, and `rules`. The trimmed name must
be non-empty. `referenceLufs` is `null` or a finite number from -70 through 0. Each rule accepts
only `metricId`, `op`, optional `value`, and `severity`; the metric must be ruleable, the operator
must be `>` or `<`, severity must be `warn` or `fail`, and a supplied value must be finite. Omitting
`value` preserves the editor's intentionally empty rule row. Unknown fields and invalid values are
reported together as `invalidProfile` issues instead of being repaired silently.

For example:

```powershell
plvs-cli loudness-profile create profile.json --expected-revision 18 --json
Get-Content profile.json -Raw | plvs-cli loudness-profile update profile-1 - --expected-revision 19 --json
```

`reorder` instead reads a JSON array containing every current Profile ID exactly once:

```json
["profile-2", "profile-1"]
```

## Reads and mutations

`describe` returns the normalized persisted Profile plus selection and order context:

```json
{
  "revision": 18,
  "profile": {
    "id": "profile-1",
    "name": "EBU R128",
    "referenceLufs": -23,
    "rules": []
  },
  "active": true,
  "index": 0
}
```

Off is a selection, not a Profile; `describe off` is invalid. The mutation semantics match the GUI:

- `select` chooses a Profile or Off and dirties the active Preset when the choice changes.
- `create` appends a generated-ID Profile, selects it, and dirties the active Preset when needed.
- `update` replaces the complete document in place; `rename` replaces only the trimmed name.
- `delete` falls back to Off only when deleting the active Profile, and replaces every matching
  Preset reference with Off.
- `reorder` changes only library order and requires an exact permutation.

Names need not be unique. Update, rename, and reorder preserve IDs and selection. Identical updates,
renames, selections, and orders succeed as no-ops; selecting or deleting an unknown ID is an error.

Every mutation returns `dryRun`, `revision`, `changed`, reserved `warnings`, a command-specific
`plan`, and compact projected `state`. Delete plans include `deletedProfile`,
`selectionFallsBackToOff`, and `affectedPresetIds`. A real create additionally returns its generated
`profile`; dry-run creation deliberately does not fabricate an ID.

## Concurrency, persistence, and editors

Every mutation requires `--expected-revision`. The Profile revision covers the active selection,
library order, and every normalized Profile field and ordered rule, so GUI edits make stale CLI
writes fail with `revisionConflict`. A command touching both Settings and Presets settles both
owners, increments the revision once, and flushes persistence before success. No-op and dry-run do
not write or increment the revision.

Dry-run performs the same validation, revision, and editor checks, then returns the projected plan
and state without allocating an ID or mutating React or persistence.

An open Loudness Profile editor blocks select, create, update, rename, and delete—even during
dry-run—with `editorActive` and `editors: ["loudnessProfile"]`. List and describe never block.
Reorder and append-only import remain allowed because neither can discard or reinterpret the draft.
Other open editors do not invoke this Profile-specific guard.

## Errors

- `loudnessProfileNotFound`, `invalidProfile`, and `invalidPermutation` exit 3.
- `revisionConflict` and `editorActive` exit 4.
- `persistenceFailed` exits 1 and reports `stateCommitted: true` plus the resulting revision when
  visible state changed before the flush failed.

Malformed JSON and unreadable input files are CLI-side `invalidArguments` failures and do not reach
the app.
