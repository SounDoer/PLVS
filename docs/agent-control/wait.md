# Revision Wait

Status: Approved design contract

Revision Wait lets an agent sleep until public state revisions change instead of repeatedly polling
inspection endpoints. The first version waits only for revision changes; arbitrary field
expressions and high-frequency runtime events are deferred.

## Command

```powershell
npm run desktop:control -- wait --workspace-revision 13 --presets-revision 7 --settings-revision 4 --transport-revision 9 --timeout-ms 30000 --json
```

At least one baseline revision is required. Supplied domains use any-of semantics: the request
returns as soon as any current value differs from its baseline. Unspecified domains do not wake the
request. Comparison and listener registration must be race-free.

A changed result reports all current revisions and which supplied domains differ:

```json
{
  "outcome": "changed",
  "changedDomains": ["workspace"],
  "revisions": {
    "workspace": 14,
    "presets": 7,
    "settings": 4,
    "transport": 9
  }
}
```

An already-stale baseline returns immediately. A timeout is a successful outcome with exit code
zero, an empty changed-domain list, and current revisions. Timeout defaults to 30000 ms, must be an
integer from 100 through 300000 ms, and may be repeated by the caller.

`wait` is read-only and has no dry-run. Baselines are not optimistic-concurrency guards. Runtime
changes such as audio frames, measurement values, VAD activity, transport progress, and the moving
LIVE edge do not wake this first version. Transport lifecycle revision changes do wake it. A
committed user or agent axis viewport change is persisted Workspace state and therefore does wake
the Workspace revision; intermediate pointer previews do not. App shutdown or loss of the frontend
is an availability/transport error, not a timeout. Revisions are process-local; after relaunch the
caller must rediscover and inspect the new application session.

## Concurrency and cleanup

Wait registration is independent from the serialized command/mutation queue, so a sleeping waiter
cannot block inspect or update. Registration and its initial comparison are race-free. A completed
App Control mutation publishes all revision changes as one snapshot and then wakes every matching
waiter once; one command changing multiple watched domains produces one result listing all of them.

At most four waits may be active concurrently, leaving at least four of the broker's eight pending
positions available for ordinary commands. An excess wait fails immediately with `busy`. This
transport-concurrency limit is unrelated to audio-analysis request counts.

A waiter is removed immediately after change, timeout, client disconnect/cancellation, frontend
unmount, or application shutdown. Returned changed domains and revision values always come from the
same committed snapshot.
