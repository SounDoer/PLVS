# Agent Control Loudness Profile Control — Design

Date: 2026-09-06
Status: Draft for discussion

## 1. Goal

Add a complete, scriptable editing surface for the same Loudness Profile library the Settings UI
owns. A caller must be able to inspect, select, create, replace, rename, delete, and reorder Profiles
without learning PLVS persistence keys or reproducing editor behavior.

The command family extends the already implemented `loudness-profile list/export/import` transfer
surface. Transfer remains append-only sharing; Control owns authoring and selection.

## 2. Scope

In scope:

- full-document inspection;
- active Profile selection, including Off;
- create, update, rename, delete, and reorder;
- strict public authoring validation followed by the existing normalization model;
- revision guards, dry-run, persistence settlement, and blocking-editor behavior;
- deletion cleanup for every Preset that references the removed Profile.

Out of scope:

- changing how rules are evaluated by Stats or the audio engine;
- editing an open GUI draft or opening/closing the Profile editor from the CLI;
- partial JSON Patch updates to individual rules;
- importing named standards or shipping new built-in templates;
- batch operations across several Profiles;
- Theme Control, which receives its own spec after this family is settled.

## 3. Existing semantic owner

`LoudnessProfileProvider` is the current owner of the library, selection, editor draft, Preset dirty
side effects, and deletion cleanup. Agent Control must call operations exposed by that owner. It must
not write `settingsStore` or `presetsStore` behind the provider and then rely on local notifications
to repair the screen.

The reusable decision layer should be pure and shared by both the provider's GUI paths and Agent
Control. The intended split is:

1. a pure planner validates an operation and projects the next Loudness Profile and Preset state;
2. `LoudnessProfileProvider` commits that plan through its existing React and persistence owners;
3. Agent Control performs protocol validation, revision checks, settlement, and response shaping.

## 4. Public commands

```text
plvs-cli loudness-profile list --json
plvs-cli loudness-profile describe <id> --json
plvs-cli loudness-profile select <id|off> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]
```

Wire methods use the existing camel-case family:

```text
loudnessProfile.describe
loudnessProfile.select
loudnessProfile.create
loudnessProfile.update
loudnessProfile.rename
loudnessProfile.delete
loudnessProfile.reorder
```

`list/export/import` keep their current shapes and behavior.

## 5. Authoring document

Create and update read one complete authoring document from a UTF-8 JSON file or stdin:

```json
{
  "name": "EBU R128",
  "referenceLufs": -23,
  "rules": [
    { "metricId": "integrated", "op": ">", "value": -22.5, "severity": "fail" },
    { "metricId": "integrated", "op": "<", "value": -23.5, "severity": "fail" },
    { "metricId": "truePeak", "op": ">", "value": -1, "severity": "warn" }
  ]
}
```

The document deliberately has no `id`:

- create mints the ID in the semantic owner;
- update takes the target ID from the command line;
- a file cannot accidentally claim one ID while the command targets another;
- `describe` output can be reused after removing its top-level `id` field.

Validation rules:

- the document is a plain object with exactly `name`, `referenceLufs`, and `rules`;
- `name` is non-empty after trimming and is persisted trimmed;
- `referenceLufs` is either `null` or a finite number from -70 through 0;
- `rules` is an array;
- each rule is a plain object with `metricId`, `op`, optional `value`, and `severity` only;
- `metricId` must be a currently ruleable Stats metric;
- `op` is `>` or `<`;
- `severity` is `warn` or `fail`;
- when present, `value` is a finite number;
- omitting `value` represents the editor's intentionally empty rule row and survives round-trip;
- unknown fields and invalid rules are rejected with issues rather than silently dropped.

After strict validation, the document passes through the same normalizer used by editor preview and
persistence. Validation protects machine callers from silent repair; normalization keeps the GUI,
disk, and runtime interpretation identical.

## 6. Read results

`list` remains compact but its revision semantics change as described in section 10:

```json
{
  "revision": 18,
  "profiles": [{ "id": "profile-1", "name": "EBU R128" }],
  "activeId": "profile-1"
}
```

`describe` returns the complete normalized persisted document and its relationship to the current
selection:

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

Off is a selection, not a library entry. `describe off` is invalid; use `list` or `select off`.

## 7. Mutation semantics

| Command | Library effect | Selection effect | Preset effect |
| --- | --- | --- | --- |
| `select <id>` | none | select the Profile | mark active Preset dirty when selection changes |
| `select off` | none | select Off | mark active Preset dirty when selection changes |
| `create` | append a generated-ID Profile | select the created Profile | mark active Preset dirty when selection changes |
| `update` | replace the complete document in place | preserve the prior selection | none |
| `rename` | replace only the trimmed name in place | preserve the prior selection | none |
| `delete` | remove the Profile | fall back to Off only when deleting the active Profile | replace every matching Preset reference with Off; dirty the active Preset only if the working selection changed |
| `reorder` | apply an exact permutation | preserve selection | none |

Names are not unique. IDs are stable across update, rename, and reorder.

Deleting an unknown ID is an error, not a successful no-op. Selecting an unknown ID is also an
error. Updating or renaming a Profile to its existing normalized value is a successful no-op.

The reorder input is a JSON array containing every current Profile ID exactly once. Missing,
duplicated, foreign, and extra IDs produce one `invalidPermutation` error and no mutation.

## 8. Mutation result

Every mutation returns:

```json
{
  "dryRun": false,
  "revision": 19,
  "changed": true,
  "warnings": [],
  "plan": {},
  "state": {
    "profiles": [{ "id": "profile-1", "name": "EBU R128" }],
    "activeId": "profile-1"
  }
}
```

Command-specific `plan` fields:

- select: `{ "from": null, "to": "profile-1" }` (`null` means Off);
- create: normalized `document` plus `selectCreated: true`; a dry-run carries no fabricated ID,
  while a real result additionally returns the created `profile`;
- update/rename: the resulting complete `profile`;
- delete: `deletedProfile`, `selectionFallsBackToOff`, and `affectedPresetIds`;
- reorder: `profileIds`.

`warnings` is reserved and empty in this version.

## 9. Dry-run

All mutations require `--expected-revision` and accept `--dry-run`. Dry-run executes the same pure
planner and validation path, returns the projected compact `state`, and performs no React update,
store write, notification, ID allocation, or revision increment.

Create dry-run cannot promise the ID of a later real request. It returns the normalized authoring
document and the fact that creation selects the new entry; the real call returns the minted ID.

Editor blocking is still evaluated during dry-run. A plan that cannot currently be committed must
not present itself as executable.

## 10. Revision and settlement

The current transfer-only implementation signs Profile IDs and names. That is insufficient once
rules and selection are mutable: a GUI rule edit or selection change could otherwise leave a stale
CLI revision apparently current.

Before shipping this family, the Loudness Profile revision signature must include:

- the active selection;
- each normalized Profile's ID, name, reference, rule order, and complete rule values;
- library order.

Any GUI or Agent Control change to that state increments the global revision and wakes `app.wait`.
A single command increments it once even when it also changes Presets.

Commands that touch Settings and Presets settle both React-owned states before returning. A real
mutation flushes persistence after settlement. No-op and dry-run return before persistence and keep
the current revision.

If persistence fails after a visible commit, return `persistenceFailed` with
`stateCommitted: true` and the resulting revision. The caller must inspect instead of retrying
blindly.

## 11. Blocking editor rules

An open Loudness Profile editor blocks `select`, `create`, `update`, `rename`, and `delete`, whether
or not its draft is dirty. These operations can invalidate, replace, or make the draft's preview
ambiguous.

`describe` and `list` never block. `reorder` follows the existing GUI rule and remains allowed: it
changes only library position, does not affect the draft document or selection, and cannot discard
typed work. Append-only `loudness-profile import` also keeps its existing non-blocking behavior.

Other blocking editors do not block Profile-library operations merely because they are open. This
is the Profile owner's draft guard, not the broader scene-operation guard used by Preset apply/save
and Dock entry.

Every blocked mutation returns `editorActive`, includes `editors: ["loudnessProfile"]`, and is
tested to have performed no mutation before refusal.

## 12. Errors

- `loudnessProfileNotFound` — target ID is absent; exit 3.
- `invalidProfile` — authoring document failed strict validation; `details.issues` contains all
  known issues with JSON paths; exit 3.
- `invalidPermutation` — reorder input is not an exact permutation; exit 3.
- `revisionConflict` — expected revision is stale; exit 4.
- `editorActive` — the Profile editor draft is open; exit 4.
- `persistenceFailed` — a committed state could not be flushed; exit 1.

Malformed local JSON and unreadable files remain CLI-side `invalidArguments` errors and never reach
the app.

## 13. Acceptance criteria

- Every command appears in root help, family help, capabilities, CLI docs, and protocol tests.
- `describe` round-trips every persisted rule field.
- create selects the created Profile; update and rename preserve selection.
- selecting the already active value and updating with identical normalized content are no-ops.
- delete reports and clears all Preset references before returning.
- a delete/select/create that changes selection marks the active Preset dirty exactly as the GUI
  does.
- all relevant editor-blocking tests assert both the refusal and pre-refusal immutability.
- GUI operations and external store changes advance the strengthened revision signature.
- each multi-store command produces one global revision and one persistence flush.
- focused tests and `npm run check` pass.

## 14. Proposed decisions to confirm

This draft proposes three public choices for review:

1. create/update files omit `id`; identity belongs to the command and semantic owner;
2. an empty rule is represented by an omitted `value`, preserving the GUI's unfinished row model;
3. reorder remains available while the Profile editor is open, matching current GUI behavior.

