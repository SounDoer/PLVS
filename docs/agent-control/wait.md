# Revision Wait

Revision Wait (`app.wait`) lets an agent sleep until the global revision changes instead of
polling inspection. Flags, the result shape, and the timeout exit code are part of the common
contract in [`../user/cli.md`](../user/cli.md#waiting-for-change); command syntax is in
[`generated/commands.md`](generated/commands.md). It waits only for revision changes — it takes no
field expressions. [Measurement Wait](measurement-wait.md) waits for a LIVE measurement sample
instead, without changing what the revision means.

## What wakes it

An already-stale baseline returns immediately with `matchedImmediately: true`.

Transport lifecycle, Settings, Preset, Dock, Workspace, panel, and committed axis viewport changes
wake it, because they advance the global revision. Audio frames, measurement values, VAD activity,
transport progress, the moving LIVE edge, and intermediate pointer previews do not.

A timeout's `error.details` carries `afterRevision` and `currentRevision`. The baseline is not an
optimistic-concurrency guard. App shutdown or loss of the frontend is an availability error, not a
timeout; because the revision is process-local, a caller must rediscover and inspect a relaunched
app.

## Concurrency and cleanup

Wait registration is independent from the serialized command/mutation queue, so a sleeping waiter
cannot block inspect or update. Registration and its initial comparison are race-free. A completed
Agent Control mutation publishes its revision change and then wakes every matching waiter once.

At most four long-poll requests may be active concurrently across `app.wait`, `measurement.wait`,
and `measurement.waitUntil`; an additional wait fails immediately with `waitLimitReached`.

A waiter is removed immediately after change, timeout, client disconnect/cancellation, frontend
unmount, or application shutdown. Returned revision values always come from committed state.
