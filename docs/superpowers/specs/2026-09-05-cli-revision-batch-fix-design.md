# CLI Revision Batch Fix

Date: 2026-09-05
Status: Approved

## Problem

One CLI mutation can settle through multiple React commits. Each commit currently increments the
global revision and wakes `app.wait`, so one logical command can produce multiple revisions and a
waiter can observe a partially applied state.

## Design

Create one in-memory revision batch around every normalized request that carries
`expectedRevision`.

- The first observable state change in the batch increments revision once.
- Further state changes in the same batch do not increment it again.
- Wait wake-ups requested during the batch are deferred.
- A `finally` block closes the batch and publishes the deferred wake-up after the command has
  succeeded or failed.
- A no-op, dry-run, or pre-mutation refusal produces no state change and therefore no increment.

The revision is still advanced at the first committed change so existing settlement promises can
return the command's final revision. Only waiter notification is delayed until the complete command
finishes.

Async lifecycle changes that occur after an action returns, such as FILE analysis reaching a
terminal state, happen outside the batch and advance revision independently.

## Concurrency

Non-wait CLI requests are already serialized. `app.wait` remains outside that queue but cannot wake
from a batched intermediate commit. UI changes that occur during a command are not lost: they share
the batch's changed revision and become visible when the deferred wake is published.

## Tests

- Stagger Preset Apply so Workspace and Preset relationship commit in separate turns.
- Before the fix, demonstrate two revision increments and an early wait result.
- After the fix, assert one revision increment and a wait result matching the command's final
  revision.
- Force a command failure after a committed change and verify the next mutation receives a fresh
  batch.
- Preserve independent post-command Transport lifecycle revision changes.

Run the focused bridge suite and the complete merge gate.
