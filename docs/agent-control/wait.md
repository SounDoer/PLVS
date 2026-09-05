# Revision Wait

Status: Approved design contract

Revision Wait lets an agent sleep until the public state revision changes instead of repeatedly
polling inspection endpoints. The first version waits only for revision changes; arbitrary field
expressions and high-frequency runtime events are deferred.

## Command

```powershell
npm run desktop:control -- wait --after-revision 13 --timeout-ms 30000 --json
```

`--after-revision <n>` is required. `--timeout-ms <n>` is optional, defaults to 30000, and must be
an integer from 100 through 300000. No other baseline flags or arbitrary state expressions are
accepted. Comparison and listener registration must be race-free.

A changed result reports whether the baseline was already stale and the current global revision:

```json
{
  "outcome": "changed",
  "matchedImmediately": false,
  "revision": 14
}
```

An already-stale baseline returns immediately with `matchedImmediately: true`. A timeout is an
error with exit code 5, not a successful unchanged result. Its `error.details` contains
`afterRevision` and `currentRevision`.

`wait` is read-only and has no dry-run or `--expected-revision`. Its baseline is not an
optimistic-concurrency guard. Runtime changes such as audio frames, measurement values, VAD
activity, transport progress, and the moving LIVE edge do not wake this first version. Transport
lifecycle, Settings, Preset, Dock, Workspace, panel, and committed axis viewport changes do wake it
through the same global revision; intermediate pointer previews do not. App shutdown or loss of
the frontend is an availability/transport error, not a timeout. Revision is process-local; after
relaunch the caller must rediscover and inspect the new application session.

## Concurrency and cleanup

Wait registration is independent from the serialized command/mutation queue, so a sleeping waiter
cannot block inspect or update. Registration and its initial comparison are race-free. A completed
App Control mutation publishes its revision change and then wakes every matching waiter once.

At most four `app.wait` requests may be active concurrently. An additional wait fails immediately
with `waitLimitReached`.

A waiter is removed immediately after change, timeout, client disconnect/cancellation, frontend
unmount, or application shutdown. Returned revision values always come from committed state.
