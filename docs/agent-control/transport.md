# Transport Control

Transport Control operates the running application's LIVE capture and FILE analysis sessions. FILE
is an analysis-result source, not media playback, and history scrubbing is view navigation rather
than transport playback.

## Commands

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

All Transport commands except `inspect`, `file report`, `file wait` and `file export-statistics`
require `--expected-revision`. `source live`, `source file`,
`live clear`, `file select`, `file remove`, and `file clear` are state mutations and support
`--dry-run`. `live start`, `live stop`, `file analyze`, `file reanalyze`, `file restore`, and `file stop` are
actions and reject `--dry-run`.

Source commands change only the selected LIVE/FILE source and never open a native file picker or
implicitly start capture/analysis. `live start` selects LIVE and starts capture. `live stop` retains
measurement data. `live clear` clears LIVE measurement/history and restarts its timeline when
capture remains active.

`snapshot select` freezes every meter at one retained history position. Its `offsetSec` is the
non-negative distance back from the newest retained sample, using the same direction and unit as a
time axis `offsetSec`. The request is rejected when no history exists or when the offset is outside
the current retained range; it is never clamped to the oldest sample. No history is the state
refusal `historyUnavailable`; an excessive offset is the invalid-input issue `outOfRange`.
`snapshot clear` leaves the snapshot and returns to the current LIVE edge or FILE result. Both
commands use the same React display operations as clicking a history chart and the GUI's Return
button. Snapshot selection is available in Dock and normal mode, does not stop LIVE capture, and
survives Dock entry and exit. FILE source entry remains unavailable while docked.

FILE commands take explicit paths or immutable session IDs. Analyze selects FILE and imports the
file exactly as the GUI does (see FILE lifecycle); reanalyze retains the selected track and preceding successful result until replacement
succeeds; stop retains partial results when no prior success exists and otherwise retains that
successful result; select chooses an
existing result; remove deletes one session; and clear deletes the complete FILE session ledger.

Reanalyze keeps the session identity for an unchanged source. If its content fingerprint changed,
it creates another entry and returns that entry's session ID, retaining the original result.
Callers must use the returned identity and inspect after completion rather than assuming the
requested session was overwritten. Unavailable original tracks or sources leave the old result intact.

While a replacement attempt is running or has failed, an entry with a retained successful result
exposes `resultAvailable: true`. Its summary, probe, analysis settings, decoded count and analysis
time describe that successful result; lifecycle/progress/error describe the attempt. `file report`
can export that retained result without waiting for the replacement. A partial first run cannot be
reported merely because it has emitted measurement frames.

File attempts use immutable requested analysis conditions and per-attempt identities internally.
Cancelling during metadata discovery prevents later worker startup; a stop failure leaves the task
busy instead of acknowledging cancellation. Completion is published after its final frame sequence
has reached the frontend, so the successful summary and browsable history refer to the same run.

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
reports the effect. A newly created additional workbench opens Stopped with Automatic selected, so
`live start` uses the same default-output policy as the first workbench.

`live stop` awaits native shutdown, retains measurement/history and device selection, and is a
no-op when stopped. `live clear` targets LIVE data regardless of the visible source: while running
it clears history, statistics, maxima, and restarts the timeline without stopping capture; while
stopped it clears retained LIVE data. Its explicit destructive verb needs no additional force flag.
Rust clear failures must propagate rather than being swallowed.

GUI and Agent Control must use one asynchronous transport controller so a successful start means the
engine is actually running and an error leaves an inspectable lifecycle state. A running capture that
fails later (no callbacks for 5 s, or a worker that exits on its own) also moves LIVE to `error` with
its reason as the last error.

## FILE lifecycle

FILE sessions are process-local analysis results and are not persisted across application restarts.
Each public summary contains immutable session ID, absolute path, file name, lifecycle
state, progress, public probe metadata, summary, timestamps, decoded frames, history availability,
compact error, and the analysis-setting snapshot used for that run. Intake buffers and other
implementation objects are never exposed.

The public lifecycle is `probing`, `analyzing`, `complete`, `stopped`, or `error`. `file analyze`
resolves a relative CLI path before transport and probes it with the GUI's import decision. A file
with several audio tracks needs `--track <index>`, the track's `index` from the probe; without it
the command fails side-effect free with `fileTrackSelectionRequired`, whose details list the
tracks, because automation cannot answer the GUI's track dialog. An unknown index is invalid input.
An unchanged file and track with a successful result and matching Dialogue Detection settings is
selected, and the action returns `status: "completed"` with that `sessionId`. An unchanged file and
track with no result or different Dialogue Detection settings reruns on its existing entry. A
different file or track creates a new ID. A started run
selects FILE and returns `status: "accepted"` with its `sessionId` after Rust accepts analysis; it
does not block until completion. A failure before acceptance fails the command and leaves an
inspectable error session when an ID was already allocated.

Only one File task may run. Analyze, reanalyze or restore while another task is active fails with
`analysisInProgress`. Reanalyze preserves the track and snapshots current analysis settings. It
replaces a result only on success; changed source content creates a new ID. Stop targets the
expected session ID, returning to `complete` when a successful result is retained, or `stopped`
when there is none. An ID that is no longer preparing or analyzing cannot stop a newer run.

Select requires an existing ID, changes the source to FILE, and never reruns it. Remove deletes only
the named session, stopping it first when necessary; clear stops any run and deletes the entire FILE
ledger. Their explicit destructive names need no additional force flag. Missing IDs are
`fileSessionNotFound`, never successful false values.

Completed statistics are retained until removed, cleared or the application exits. Browsing history
is managed independently by resource budget. Inspection exposes `historyReleased`,
`historyAvailable` and `files.preparingId`. `file restore <session-id>` rebuilds released history
with the original source version, track and analysis conditions while preserving statistics and
provenance. Changed or unavailable sources cannot restore the old history. `file remove` and
`file clear` can preview the sessions they would delete.

Entering FILE by source, analyze, or select is refused while Dock is active; Agent Control never exits
Dock implicitly. Leaving an active FILE analysis for LIVE requires `--allow-stop-file-analysis` and
retains partial results. Switching from LIVE to FILE stops capture but retains LIVE data and needs no
extra confirmation.

Already completed FILE results do not retroactively change with Settings or Panel analysis-request
changes. Use [Settings Control](settings.md#file-dialogue-detection) to read or change the File
toolbar's Dialogue Detection switch. Inspect each session's `analysisSettings.dialogue` to see the
conditions captured for its result. Reanalyze applies current settings, and importing the same source
and track again can rerun the existing entry when the dialogue conditions differ.

FILE uses the same retained snapshot selection as LIVE. This reflects the existing FILE history
scrub and Return to File Result behavior; it does not add playback or seek semantics. Selection is
available while the active FILE result has retained history.

## Waiting for a File run

An accepted analyze, reanalyze or restore returns `sessionId` and `runId`. Pass both to
`transport file wait <session-id> --run-id <n> --json`. Analyze can also return
`status: "completed"` when it reuses a successful result. In that case the result is ready to report.

Wait returns `outcome` as `complete`, `error`, or `stopped`. The latest run's identity and
outcome are also visible as `runId` and `runOutcome` on the session in Transport inspection.
A newer run on that session yields `superseded` for the older identity. A missing session or
unknown future run yields `unavailable`. A retained report can coexist with an active, failed, or
stopped replacement. Use the wait outcome to decide whether the replacement succeeded.

The timeout applies to the wait. Analysis continues until it finishes or is stopped separately.
Runs are local to the running application and share the Agent Control long-wait limit.

## FILE reports

File results expose the optional maximum-location metadata documented in
[File Mode](../user/file-mode.md#maximum-locations). `file report` preserves these coordinates
and per-channel associations in JSON and Markdown. This is File-only metadata: no Live
Measurement Control fields or subscriptions change.

Completed file summaries and JSON/Markdown reports include whole-file Sample Peak Max and True
Peak Max for every decoded channel. `summary.channelPeaks` is ordered by zero-based `channelIndex`;
Each entry carries its result-bound channel label, with generic labels for unknown layouts.
`samplePeakMaxDb` and `truePeakMaxDbtp` are the maxima across **all** channels, including channels
outside the loudness layout. Unavailable values (including digital silence) are JSON `null` and
shown as a dash in text. The compatibility fields `samplePeakMaxLDb` and `samplePeakMaxRDb` mean
decoded channels 1 and 2; mono duplicates channel 1 in both.

`transport file report <session-id> --json [--report-format <json|markdown>] [--out <file>]` returns the same versioned `fileAnalysis`
report that the GUI's file-row Export menu saves, built by the same frontend builder. It is a read: it never
selects the session, changes the source, starts or stops analysis, or increments revision, and it
works in either source mode while the session is retained.

Only successful results are reported. A replacement attempt can have `resultAvailable: true`
even while running or after failure; the report then uses the previous success. An unknown ID
fails with `fileSessionNotFound`; an entry without a successful result fails with
`fileAnalysisNotComplete`, whose details carry the session ID and public state.

The success result is `{ revision, sessionId, report }`. `--out` moves the report into a file and
replaces `result.report` with `result.out`, exactly as library and configuration export do; see
[Output Files](../user/cli.md#output-files). `fileAnalysis` schema version 3 removes `source.path`,
reports actual duration in `source.durationMs`, preserves the estimate as `source.declaredDurationMs`,
and adds path-free source version identity and explicit `unavailableReasons`. Consumers migrating
from version 2 should identify files using `source.fileName`, `source.version` and track metadata.
The internal capture harness output is a separate contract.

`--report-format markdown` returns `{ revision, sessionId, markdown }` instead: the same report
rendered by the function behind the GUI's Export Markdown and Copy as Markdown, so all three are
identical. `--out` then writes that text verbatim. JSON remains the default format.

The report's `loudnessProfile` block records the Loudness Profile in force at export: `mode` is
`off`, `saved`, or `preview` (an open editor's draft), `rules` holds its filled rules, and
`byMetric` gives each judged metric `ok`, `warn`, `fail`, or `notEvaluated`. Only whole-file
readings are judged; a rule on a momentary or derived metric, or on a reading the file does not
have, is `notEvaluated`. `counts` counts configured metrics once at their worst verdict, and
`overall` is `notEvaluated` when off/empty; otherwise `fail`, `warn`, `notFullyEvaluated` or `ok`
in precedence order.

**Export Statistics…** uses the GUI File Statistics picker and native save dialog. For automation,
`transport file export-statistics <file|-> --out <file> --json` takes a JSON object with a nonempty
`sessionIds` array. All IDs must be distinct and have a successful result. Retained results remain
eligible during reanalysis. Rows follow the supplied order and use the effective Loudness Profile
at export. The CLI writes the same UTF-8 BOM CSV as the GUI and returns the output path.

## Paced scrubbing

`transport snapshot select` accepts `--steps` and `--duration-ms` to move the Snapshot in evenly
spaced steps, starting from the Live edge when no Snapshot is selected; see
[Axis Control](axes.md#paced-changes) for the shared rules.

## Revision and waiting

Transport changes use the application's single process-local revision. It increments on source
changes, LIVE lifecycle transitions, FILE ledger/selection changes, and FILE lifecycle
completion/error, and snapshot selection changes from either the GUI or Agent Control, but not for
audio frames, progress percentages, elapsed clock ticks, or history viewport movement. An accepted
async file run increments when it starts and again when it reaches a terminal state.

Every Transport mutation and action requires `--expected-revision`. `wait --after-revision
<n> --timeout-ms <n>` can sleep until an analysis completes or another observable state change
occurs without waking for every progress update.

Transport state is not durable, so commands wait for relevant native acknowledgements but not a
persistence flush. State-mutation dry-runs return predicted Transport state without calling native
transport operations or incrementing revision. `file clear` and `file remove` previews report the
sessions that would be deleted. Actions do not support dry-run. State-mutation no-ops return
`changed: false` and do not increment revision or call native transport operations.

## Inspection and results

`transport.inspect` returns top-level `revision`, selected source, snapshot state as
`snapshot { active, offsetSec }`, LIVE lifecycle/device summary, and ordered public FILE session
summaries with active/analyzing IDs. `offsetSec` is null while no snapshot is active. The same
Transport object is embedded in `app.inspect`.

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
