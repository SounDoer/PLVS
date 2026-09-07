# Measurement Wait

Status: Implemented

Measurement Wait lets an agent wait for the next coherent LIVE semantic measurement without
polling `measurement inspect`. It extends [Measurement Control](measurements.md); it is separate
from [Revision Wait](wait.md), which observes committed control-state revisions rather than audio
measurements.

## Command

```powershell
npm run desktop:control -- measurement wait --after-generation 3 --after-sequence 127 --timeout-ms 30000 --json
```

`--after-generation <n>` is required. `--after-sequence <n>` is optional and is omitted when the
baseline `measurement inspect` returned `sample.sequence: null`. `--timeout-ms <n>` is optional,
defaults to 30000, and must be an integer from 100 through 300000.

The public wire parameters are:

```json
{
  "afterGeneration": 3,
  "afterSequence": 127,
  "timeoutMs": 30000
}
```

`afterGeneration` and `afterSequence` must be non-negative safe integers. Omitting
`afterSequence` means that the caller observed no sample in that generation; it is not a wildcard.
The command accepts no source, expected revision, dry-run, input, output, or confirmation option.

## Match semantics

The baseline is the measurement identity returned by `measurement inspect`:
`source.sessionGeneration` plus `sample.sequence`. A wait matches when a non-null LIVE sample is
publicly available and its identity differs from the baseline.

- A later frame in the same generation matches.
- A sample from a different generation matches.
- A generation change with no sample does not match. A LIVE clear therefore does not return an
  empty result; the wait continues until that generation, or a later one, publishes a sample.
- A sample already different when the request is registered returns immediately.
- LIVE lifecycle changes, global revision changes, transport progress, and age/freshness changes
  alone do not match.
- A failed LIVE restart retains the previously committed generation and sample and does not create
  a false match.

The comparison and waiter registration must be race-free. A sample arriving at the registration
boundary is either returned immediately or wakes the registered waiter; it cannot be missed.

Measurement Wait never starts capture, clears data, changes the selected source, creates optional
Vectorscope or Dialogue demand, or manufactures a measurement while LIVE is stopped. A stopped or
errored LIVE session may therefore time out normally.

## Success result

A successful wait returns the complete bounded snapshot in the same shape as
`measurement inspect`, nested under `measurement`:

```json
{
  "outcome": "sample",
  "matchedImmediately": false,
  "measurement": {
    "revision": 14,
    "schemaVersion": 1,
    "source": {
      "kind": "live",
      "state": "running",
      "sessionGeneration": 3
    },
    "sample": {
      "sequence": 128,
      "freshness": "fresh"
    }
  }
}
```

`matchedImmediately` is true only when a matching sample was already public during registration.
The returned `measurement.observedAt`, `sample.ageMs`, freshness, channel labels, active optional
analysis, and Loudness Profile evaluation are all formed together at completion time. The command
does not return an earlier snapshot captured merely to test the baseline.

## Timeout and errors

Timeout is an error with public code `timeout` and CLI exit code 5, matching Revision Wait. Its
details contain the submitted baseline and the latest observable LIVE identity and lifecycle:

```json
{
  "afterGeneration": 3,
  "afterSequence": 127,
  "currentGeneration": 3,
  "currentSequence": 127,
  "liveState": "stopped"
}
```

`currentSequence` is null when no sample is available. Snapshot construction failure uses
`measurementSnapshotFailed`, as `measurement inspect` does. App shutdown, loss of the frontend,
and client disconnection remain availability or cancellation errors rather than timeouts.

## Concurrency and cleanup

Measurement Wait and Revision Wait share one limit of four active long-poll requests. This keeps
long waits from consuming every broker pending slot and leaving no capacity for inspection or
mutation. A request beyond the shared limit fails immediately with `waitLimitReached`.

Long waits bypass the serialized mutation queue. Completion, timeout, client cancellation,
frontend unmount, and application shutdown remove the waiter and its timer immediately. Every
transport layer must derive its deadline from either `app.wait` or `measurement.wait`; the
frontend timeout plus the existing broker/client grace periods remains authoritative.

## Revision behavior

Published measurement samples and completed Measurement Wait queries do not increment the global
revision and do not wake `app.wait`. The nested measurement snapshot reports the current revision
only as contemporaneous control-state context.

## Deliberate first scope

The first implementation waits only for a different measurement identity. It does not accept
metric paths, comparison operators, threshold expressions, stability durations, FILE sessions, or
raw/history data. An agent that needs a readiness or threshold condition performs a bounded loop:
wait for one sample, evaluate the returned snapshot, and use its identity as the next baseline.
