# Preset Control

Status: Approved design contract

Preset Control exposes the existing GUI Preset operations through the development App Control
protocol.

## Commands

```powershell
npm run desktop:control -- preset list --json
npm run desktop:control -- preset describe <preset-id> --json
npm run desktop:control -- preset save <name> --expected-revision 12 --json
npm run desktop:control -- preset apply <preset-id> --expected-revision 12 --json
npm run desktop:control -- preset update <preset-id> --expected-revision 12 --json
npm run desktop:control -- preset rename <preset-id> <name> --expected-revision 12 --json
npm run desktop:control -- preset delete <preset-id> --expected-revision 12 --json
npm run desktop:control -- preset reorder <file|-> --expected-revision 12 --json
```

- `list` returns ordered `{ id, name }` summaries plus `activeId` and `dirty`.
- `describe` returns one Preset's public saved snapshot.
- `save` captures the current application view into a newly named Preset, activates it, and marks
  it clean.
- `apply` restores an existing Preset without changing the saved Preset.
- `update` replaces an existing Preset snapshot with the current application view while retaining
  its ID and name, then activates it and marks it clean.
- `rename` changes only the name.
- `delete` removes the Preset; deleting the active Preset clears `activeId`.
- `reorder` changes only library order.

There is no initial `duplicate` command because the GUI does not provide that operation. Individual
Preset import/export remains outside this command family. Portable whole-configuration backup and
migration belong to future `app config` control; no existing public command provides them.

`app.inspect` continues to return only the compact active relationship. Call `preset list` for the
library:

```json
{
  "preset": {
    "activeId": "preset-1",
    "dirty": true
  }
}
```

## Saved snapshot

A Preset is a saved working scene, not a whole-application backup. It captures the same state as the
existing GUI:

1. **Workspace:** layout, panel identities/titles, public controls, pin state, shared and local axes,
   and axis-link state.
2. **Window presentation:** bounds when they can be read, Always On Top, Focus View
   (`autoHideControls`, `compactPanels`, `borderless`), panel opacity, and glass state.
3. **Dock:** enabled state, edge, monitor, reserve-space choice, height, Dock panels, order, sizes,
   and controls.
4. **Loudness Profile selection:** only the selected Loudness Profile ID, not a copy of its rules or
   library.

It does not capture Theme/Appearance, Dialogue Detection engine, History Length or other global
Settings, audio device, capture state, open media, transport position, measurement/history data,
accumulated maxima, Loudness Profile/Preset libraries, or transient UI state.

## Public description

`preset.describe` converts the stored snapshot to public App Control shapes rather than returning
the internal persistence record:

```json
{
  "preset": {
    "id": "preset-1",
    "name": "Mixing",
    "workspace": {
      "layout": {},
      "panels": []
    },
    "window": {
      "bounds": null,
      "pinned": false,
      "focusView": {
        "autoHideControls": false,
        "compactPanels": false,
        "borderless": false
      },
      "panelOpacity": 100,
      "glassEnabled": false
    },
    "dock": {},
    "loudnessProfile": {
      "activeId": null
    }
  }
}
```

Panel entries use the same public controls and axes as inspection, but contain no control schema or
analysis runtime. `window.bounds` is null when it was unavailable at capture time rather than being
fabricated. Machine-specific bounds and monitor identity are reported as saved because App Control
is local. Loudness control availability inside the snapshot is interpreted using the Preset's saved
Loudness Profile selection, not the Loudness Profile currently active in the application.

## Revision and dry run

Every Preset mutation requires one optimistic-concurrency input:

```text
--expected-revision <n>
```

It protects the complete public application state inspected by the caller. `save`, `update`, and
`apply` depend on both the current scene and Preset library; `rename`, `delete`, and `reorder`
depend on the library, but use the same global precondition. Read commands take no expected
revision.

Creating, updating, renaming, deleting, or reordering the library increments the global revision.
A change to `activeId`, `dirty`, or the applied scene uses that same counter. One observable command
increments it at most once.

Mutation results return the current value:

```json
{
  "revision": 13
}
```

Every Preset mutation supports `--dry-run`. It performs the same ID/name, revision, snapshot,
availability, reorder, warning, and final-state computation without writing state, changing active
or dirty state, applying window/Dock state, or persisting. The returned revision remains the real
current value; the rest of the result describes the preview. A revision conflict is always
side-effect free.

## Mutation results

Mutation commands return a compact operation result rather than duplicating the complete
`app.inspect` snapshot:

```json
{
  "dryRun": false,
  "changed": true,
  "revision": 13,
  "state": {
    "preset": {
      "id": "preset-1",
      "name": "Mixing"
    },
    "presets": {
      "activeId": "preset-1",
      "dirty": false
    }
  },
  "warnings": []
}
```

`changed` is a boolean. `save`, `apply`, `update`, and `rename` return the affected Preset summary
under `state.preset`; compact library state is under `state.presets`; `delete` also returns
`deletedPreset`; and `reorder` includes the final ordered ID list in `state.presets`. Call
`app.inspect` or `preset.describe` when the complete resulting scene is needed.

Dry-run uses the same result shape, reports the changes that a real execution would make, and leaves
the returned revision at its real current value. A dry-run of `save` returns `{ "id": null }`
because no persistent identity is allocated until the Preset is actually created.

## Input validation

Preset commands address Presets only by immutable ID; names are display labels and are never used
to resolve a target. Save and rename follow the existing GUI rule: the input must be a string whose
trimmed value is non-empty, the trimmed value is stored, and duplicate names are allowed. App
Control does not introduce a separate name length or character restriction. Any future restriction
must be implemented as one shared GUI, Dock, and App Control rule.

`preset reorder` accepts an object with an explicit ordered-ID field:

```json
{
  "presetIds": ["preset-3", "preset-1", "preset-2"]
}
```

The list must contain every current Preset ID exactly once, with no missing, duplicate, or unknown
ID. Invalid input fails atomically. Request-shape validation runs first, followed by expected-
revision checking and then state-dependent validation such as target existence. A missing target is
reported as `presetNotFound`, never collapsed into a successful `false` result. Every validation
failure leaves the library, active/dirty state, revision, Workspace, and persistence unchanged.

## Deletion safety

`preset delete` removes only the saved Preset record. It never restores, resets, or otherwise
changes the current Workspace, window, Dock, or Loudness Profile selection. Deleting an inactive
Preset changes only the library. Deleting the active Preset also clears `activeId` and sets `dirty`
to false because there is no longer a saved baseline to compare with; the current scene, including
any unsaved divergence from that Preset, remains intact. Deleting the last Preset is valid.

An active draft editor does not block deletion because deletion neither captures nor replaces the
editing scene. The command requires an exact ID but no extra `--force` or interactive confirmation;
dry-run and the expected revision provide preview and concurrency protection. A successful delete
increments the global revision and returns `deletedPreset` plus the final compact Preset state.

## Persistence settlement

A successful mutation means both the in-memory/UI commit and all relevant durable persistence have
completed. Success therefore carries no redundant `persisted: true` field. Dry-run and a true no-op
perform no persistence work.

If persistence fails after state has committed, the command fails with `persistenceFailed` and
reports `stateCommitted: true` plus the resulting revision. It does not attempt an automatic
rollback. The caller must inspect again before issuing another mutation; it must not continue from
its earlier snapshot or revision.

## Apply failure and partial state

Preset Apply cannot promise absolute atomicity because Dock and window changes cross into operating-
system APIs that may fail at execution time. It instead performs a complete side-effect-free
preflight first: editor safety, revision, target and snapshot validity, referenced-resource
resolution, and every compatibility check that can be decided in advance.

An execution-time failure does not trigger an automatic rollback. The error reports
`applicationFailed`, the failing `stage`, whether application was `partial`, the public paths already
changed under `error.details.changed`, the resulting revision, and the final compact Preset state.
This string array is distinct from the boolean `result.changed` on success. A partially applied
scene is not associated with either the old or target Preset: `activeId` is null and `dirty` is
false. The caller must inspect again before continuing. Dry-run exercises the deterministic
preflight but does not claim that future operating-system calls are guaranteed to succeed.

## Unavailable saved resources

Preset Apply distinguishes a resource that has a safe fallback from a current-mode conflict:

- A deleted Loudness Profile resolves to Off and produces `loudnessProfileUnavailable`.
- A missing saved Dock monitor falls back to the current monitor and then the primary monitor, and
  produces `dockMonitorUnavailable`. It fails only when no monitor is available.
- Off-screen saved window bounds are adjusted into the visible display area and produce
  `windowBoundsAdjusted`.
- A platform without Dock support drops the saved Dock state, applies the rest of the Preset, and
  produces `dockUnsupported`.
- FILE mode is different: both direct Dock entry and a Preset that requires Dock are refused. Preset
  Apply reports the existing shared contract `code: fileModeActive`, `reason: fileMode`, and
  `operation: preset.apply`, and the preflight refusal has no side effects.

Warnings report both requested and effective values where applicable. App Control must preserve
the structured scene-refusal error from the shared controller rather than collapsing it into the
GUI-facing boolean result.

## No-op semantics

Preset mutations compare the complete effective result rather than assuming that every command
changes state. Renaming to the same trimmed name, submitting the current order, updating with an
identical snapshot while already active and clean, or applying a scene that is already active and
clean succeeds with `changed: false`. A no-op increments no revision, performs no persistence, and
does not repeat window or Dock operations.

Matching scene content with a different `activeId` changes only Presets state. Matching scene
content with `dirty: true` clears dirty and changes only Presets state. `save` always creates a new
identity and `delete` always removes one; neither has a successful no-op form. A missing delete
target is `presetNotFound`. Editor and expected-revision guards run before no-op detection.

## Active editor safety

Preset Control uses the application's shared scene-operation guard. While any draft-style editor is
open, `save`, `apply`, and `update` fail before changing Workspace, window, Dock, Loudness Profile
selection, Preset state, or persistence. The rule depends on whether an editor is open, not whether
its draft is already dirty. Current blocking editors are the Loudness Profile Editor and Theme
Editor.

`list`, `describe`, `rename`, `delete`, and `reorder` remain available because they neither capture
nor replace the current scene. Entering Dock is independently protected by the same guard.

The App Control CLI does not bypass this behavior or modify persisted Preset files directly. Rust
delivers the request to the running React application, which executes the existing Preset business
logic and returns its result. If PLVS is not running, App Control is unavailable by design.

A refusal uses the stable `editorActive` reason and identifies both the requested operation and all
active blocking editors. No command provides a flag that silently discards their drafts.
