# Transport Control

Status: Implemented

Transport Control operates the running application's LIVE capture and FILE analysis sessions. FILE
is an analysis-result source, not media playback, and history scrubbing is view navigation rather
than transport playback.

## Commands

```powershell
npm run desktop:control -- transport inspect --json
npm run desktop:control -- transport source live --expected-revision 12 --json
npm run desktop:control -- transport source file --expected-revision 12 --json
npm run desktop:control -- transport live start --expected-revision 12 --json
npm run desktop:control -- transport live stop --expected-revision 12 --json
npm run desktop:control -- transport live clear --expected-revision 12 --json
npm run desktop:control -- transport file analyze <path> --expected-revision 12 --json
npm run desktop:control -- transport file reanalyze <session-id> --expected-revision 12 --json
npm run desktop:control -- transport file stop <session-id> --expected-revision 12 --json
npm run desktop:control -- transport file select <session-id> --expected-revision 12 --json
npm run desktop:control -- transport file remove <session-id> --expected-revision 12 --json
npm run desktop:control -- transport file clear --expected-revision 12 --json
npm run desktop:control -- transport file report <session-id> --json --out mix-report.json
```

All Transport commands except `inspect` and `file report` require `--expected-revision`. `source live`, `source file`,
`live clear`, `file select`, `file remove`, and `file clear` are state mutations and support
`--dry-run`. `live start`, `live stop`, `file analyze`, `file reanalyze`, and `file stop` are
actions and reject `--dry-run`.

Source commands change only the selected LIVE/FILE source and never open a native file picker or
implicitly start capture/analysis. `live start` selects LIVE and starts capture. `live stop` retains
measurement data. `live clear` clears LIVE measurement/history and restarts its timeline when
capture remains active.

FILE commands take explicit paths or immutable session IDs. Analyze selects FILE and starts a new
session; reanalyze retains the session identity; stop retains partial results; select chooses an
existing result; remove deletes one session; and clear deletes the complete FILE session ledger.

There is no context-sensitive generic start, stop, or clear command. The GUI's changing primary
button is appropriate for a visible human surface, while explicit LIVE and FILE verbs prevent an
agent from applying the current mode's destructive meaning by accident.

Transport owns source and lifecycle; [Device Control](devices.md) owns the persisted requested
capture device. `device select` may restart an already-running Live session after explicit
confirmation, but it does not replace `transport live start/stop`, change the LIVE/FILE source, or
stop File analysis. Doctor's `device-enumeration` check diagnoses the installed capture rig and is
not a running-app selection command.

## LIVE lifecycle

LIVE exposes `stopped`, `starting`, `running`, `stopping`, or `error`, together with requested and
resolved device identity, start time, whether the view is at the live edge, and a compact last error.
Agent Control completion follows the native engine acknowledgement rather than the GUI's current
optimistic `running` boolean.

`live start` selects LIVE, retains prior LIVE data, and succeeds only after device resolution,
capture startup, and frame-channel readiness. Running is a no-op; starting/stopping returns
`transitionInProgress`. It does not change a historical viewport. If FILE analysis is active, start
requires `--allow-stop-file-analysis`, stops that analysis while retaining partial results, and
reports the effect.

`live stop` awaits native shutdown, retains measurement/history and device selection, and is a
no-op when stopped. `live clear` targets LIVE data regardless of the visible source: while running
it clears history, statistics, maxima, and restarts the timeline without stopping capture; while
stopped it clears retained LIVE data. Its explicit destructive verb needs no additional force flag.
Rust clear failures must propagate rather than being swallowed.

GUI and Agent Control must use one asynchronous transport controller so a successful start means the
engine is actually running and an error leaves an inspectable lifecycle state.

## FILE lifecycle

FILE sessions are process-local analysis results and are not persisted across application restarts.
Each public summary contains immutable session ID, canonical absolute path, file name, lifecycle
state, progress, public probe metadata, summary, timestamps, decoded frames, history-truncation
status, compact error, and the analysis-setting snapshot used for that run. Intake buffers and other
implementation objects are never exposed.

The public lifecycle is `probing`, `analyzing`, `complete`, `stopped`, or `error`. `file analyze`
resolves a relative CLI path before transport, validates/probes it, creates a new ID, selects FILE,
and returns after Rust accepts analysis; it does not block until completion. Repeating the same path
creates another session, matching GUI behavior. A failure before acceptance fails the command and
leaves an inspectable error session when an ID was already allocated.

Only one file analysis may run. Analyze or reanalyze while another is active fails with
`analysisInProgress`. Reanalyze preserves ID and path, replaces prior results, snapshots current
analysis settings, and needs no extra force flag because the verb is explicit. Stop requires the
expected session ID, retains partial data and last progress, and maps to public `stopped`; an ID that
is no longer the analyzing one fails without stopping a newer run.

Select requires an existing ID, changes the source to FILE, and never reruns it. Remove deletes only
the named session, stopping it first when necessary; clear stops any run and deletes the entire FILE
ledger. Their explicit destructive names need no additional force flag. Missing IDs are
`fileSessionNotFound`, never successful false values.

The current GUI retains at most five FILE sessions and may evict the oldest completed, stopped, or
error entry that is neither active nor analyzing when a new entry exceeds that limit. Agent Control
keeps this behavior but never hides it: analyze returns `evictedSessions` summaries and dry-run
previews them.

Entering FILE by source, analyze, or select is refused while Dock is active; Agent Control never exits
Dock implicitly. Leaving an active FILE analysis for LIVE requires `--allow-stop-file-analysis` and
retains partial results. Switching from LIVE to FILE stops capture but retains LIVE data and needs no
extra confirmation.

Already completed FILE results do not retroactively change with Settings or Panel analysis-request
changes. Commands that alter relevant configuration report `fileReanalysisRequired`; only an
explicit reanalyze starts new work.

## FILE reports

`transport file report <session-id> --json [--out <file>]` returns the same versioned `fileAnalysis`
report that the GUI's Export button saves, built by the same frontend builder. It is a read: it never
selects the session, changes the source, starts or stops analysis, or increments revision, and it
works in either source mode while the session is retained.

Only `complete` sessions are reported. An unknown ID fails with `fileSessionNotFound`; a `probing`,
`analyzing`, `stopped`, or `error` session fails with `fileAnalysisNotComplete`, whose details carry
the session ID and public state. A stopped session's partial summary does not describe the whole
file, and the report schema has no field that marks a partial report.

The success result is `{ revision, sessionId, report }`. `--out` moves the report into a file and
replaces `result.report` with `result.out`, exactly as library and configuration export do; see
[Output Files](../cli.md#output-files). `fileAnalysis` schema version 1 is the only public
file-analysis report format; the internal capture harness output is not a public contract.

## Revision and waiting

Transport changes use the application's single process-local revision. It increments on source
changes, LIVE lifecycle transitions, FILE ledger/selection changes, and FILE lifecycle
completion/error, but not for audio frames, progress percentages, elapsed clock ticks, or history
viewport movement. An accepted async file run increments when it starts and again when it reaches a
terminal state.

Every Transport mutation and action requires `--expected-revision`. `wait --after-revision
<n> --timeout-ms <n>` can sleep until an analysis completes or another observable state change
occurs without waking for every progress update.

Transport state is not durable, so commands wait for relevant native acknowledgements but not a
persistence flush. State-mutation dry-runs return predicted Transport state without calling native
transport operations or incrementing revision. `file clear` and `file remove` previews report the
sessions that would be deleted. Actions do not support dry-run. State-mutation no-ops return
`changed: false` and do not increment revision or call native transport operations.

## Inspection and results

`transport.inspect` returns top-level `revision`, selected source, LIVE lifecycle/device summary,
and ordered public FILE session summaries with active/analyzing IDs.

State mutations return `dryRun`, boolean `changed`, `revision`, `effects`, `warnings`, any
affected/evicted session summaries, and the complete predicted or resulting snapshot under
`state.transport`. Actions return `action`, `status`, `revision`, `effects`, `warnings`, any
affected/evicted session summaries, and the resulting snapshot under `state.transport`. Progress is
a bounded value from zero through one but is advisory; lifecycle is authoritative.

Predictable validation, revision, mode, confirmation, and concurrency failures are side-effect free.
Execution failures report stage, partial state, `error.details.changed` path strings, current
revision, and any session allocated before failure. This array is distinct from the boolean
`result.changed` used by successful state mutations. The caller must inspect after a partial
result.
