# CLI Preset Blocking-Editor Race Fix

Date: 2026-09-05
Status: Approved

## Problem

`preset.save`, `preset.update`, and `preset.apply` check the shared blocking-editor guard before
awaiting an asynchronous scene snapshot. A Theme or Loudness Profile editor can open while that
snapshot is pending. Opening an editor does not advance the global control revision, so the
post-snapshot revision check succeeds and the command can continue despite the newly protected
draft.

## Design

Keep the existing initial guard so an already-open editor is rejected before snapshot work starts.
After each awaited snapshot and immediately before the first state-changing Preset operation,
invoke the same `assertSceneOperationAllowed` guard again.

Do not add a new editor generation counter or change the revision contract. The existing guard is
the authority for whether a scene operation may proceed; the bug is only that its result is stale
after an asynchronous boundary.

## Behavior

- An editor open before the command remains rejected as today.
- An editor opened while scene capture is pending is rejected with `editorActive`.
- The refusal occurs before Preset, Workspace, window, Dock, or persistence mutation.
- Commands remain allowed when no blocking editor opens.
- Revision behavior and successful response shapes do not change.

## Tests

For save, update, and apply, use a deferred snapshot promise:

1. Start the command with no blocking editor.
2. Confirm snapshot capture has started.
3. Make the blocking-editor guard begin refusing scene operations.
4. Resolve the snapshot.
5. Assert `editorActive` and verify no state-changing callback or persistence flush ran.

Run the focused bridge suite, then the complete merge gate.
