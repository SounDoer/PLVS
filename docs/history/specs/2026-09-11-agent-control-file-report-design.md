# Agent Control File Analysis Report

Date: 2026-09-11

Status: Approved design; extended by
[File Analysis Report: Markdown and Loudness Profile Verdicts](2026-09-11-file-report-markdown-design.md),
which adds the `loudnessProfile` block and `--report-format`. Where the two disagree, that design
wins.

## Purpose

The GUI's File mode summary bar has an **Export** button that saves a completed file analysis as a
versioned `fileAnalysis` JSON report. Agent Control can already read every FILE session's raw
summary through `transport inspect`, but it cannot produce that report. This design adds the CLI
equivalent of the Export button so scripts, fixtures, and bug reports receive exactly the document
a user would export from the GUI.

## Product boundary

This command controls the running app only. It does not reopen the headless-analysis decision in
[PLVS CLI v1](2026-09-05-cli-v1-design.md): analyzing a file while PLVS is closed remains outside
the public CLI, and `doctor` remains its only offline operational command.

`fileAnalysis` schema version 1, built by `buildFileAnalysisReport` in
`src/lib/fileAnalysisReport.js`, is the only public file-analysis report format. The internal
capture harness `analyze` output (`src-tauri/src/cli_analyze.rs`) is release-verification tooling
with its own envelope and makes no public compatibility promise. The two share measurement numbers,
which `summary_and_session_paths_agree_on_delivery_metrics` pins to exact equality, but not a report
document. They are deliberately not unified: the public report's inputs (analysis settings,
timestamps, history-truncation status) live in the frontend session registry, so moving its builder
into Rust would add a round trip without removing an owner.

## Public shape

```text
plvs-cli transport file report <session-id> --json [--out <file>]
```

- Command ID and wire method: `transport.file.report`.
- `session-id` is required and is an immutable FILE session ID from `transport inspect`. There is no
  default to the active session, matching every other `transport file` command.
- Classification: `runningApp` query. No `--expected-revision`, no `--dry-run`.
- Output file: optional. Because the command can write a file, `--json` is required and
  `--format text` is not accepted, matching `preset export` and `config export`.

## Semantics

The command is a read. It never selects the session, changes the source, starts or stops analysis,
increments revision, or writes persistence. It succeeds in either LIVE or FILE source mode, and
while Dock is active, as long as the named session is still retained.

The frontend handler finds the session in the FILE session registry and calls the existing
`buildFileAnalysisReport(session, { appVersion })`, with `appVersion` taken from the running app's
runtime version. `exportedAt` is the request time. The CLI adds no fields and has no report builder
of its own.

Only sessions in the public `complete` state can be reported, matching the GUI guard. A `stopped`
session holds partial results whose summary does not describe the whole file, and the v1 schema has
no field that marks a partial report, so it is refused rather than exported.

## Result

Without `--out`, the success result is:

```json
{
  "revision": 42,
  "sessionId": "file-analysis-1757548800000-k3j9x2",
  "report": { "schemaVersion": 1, "reportType": "fileAnalysis", "...": "..." }
}
```

With `--out <file>`, the report moves out of the envelope exactly as library and configuration
export do: Rust writes the pretty-printed report plus a trailing newline, then replaces
`result.report` with `result.out`. The swap happens only after the bytes are on disk, so a write
failure exits 1 with the report still recoverable from stdout.

## Errors

| Condition                                                | Code                                     | Details                     |
| -------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| No retained session has this ID                          | `fileSessionNotFound` (existing, exit 3) | `sessionId`                 |
| Session is `probing`, `analyzing`, `stopped`, or `error` | `fileAnalysisNotComplete` (new)          | `sessionId`, public `state` |

`fileAnalysisNotComplete` uses the same exit class as `fileAnalysisNotActive`: the target exists but
its lifecycle state does not permit the request. Both refusals are side-effect free.

FILE sessions are process-local and are not persisted across restarts, so a report must be exported
before PLVS quits.

## Implementation surface

| Area             | Change                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command manifest | Add `transport.file.report` to `src/agentControl/commandManifest.json`; capabilities, `schema`, completions, and `generated/commands.md` derive from it |
| Protocol         | Validate `{ sessionId }` params in `src/agentControl/protocol.js`                                                                                       |
| Frontend         | Handle the method in `useAgentControlBridge.js` using the session registry and `buildFileAnalysisReport`                                                |
| Rust CLI         | Parse the command in `cli_control.rs`; extend `finish_export` so `--out` moves the `report` field                                                       |
| Exit class       | Add `fileAnalysisNotComplete` to the application error table in `cli_control.rs`                                                                        |
| Docs             | `docs/agent-control/transport.md`, `docs/cli.md`; mark File report export done in the CLI roadmap                                                       |

## Testing

- Bridge tests: complete session returns the same document as `buildFileAnalysisReport` for the
  same session; unknown ID and each non-complete state are refused; refusal and success leave
  transport state and revision unchanged.
- Protocol tests: missing, empty, and non-string `sessionId`; unknown params rejected.
- Rust tests: argument parsing, `--out` moves `report` to `out`, write failure keeps `report` and
  exits 1, `fileAnalysisNotComplete` exit class.
- Manifest, capabilities coverage, and documentation contract tests updated with the new command.
- Desktop acceptance: analyze a short file in the running development app, then run the command with
  and without `--out` on Windows; the macOS run is performed on a Mac.

## Out of scope

- Public headless `analyze`, `analyze-batch`, or `report` formatting commands.
- FILE-mode measurement queries by time point or range, and any history export.
- Reports for partial (`stopped`) sessions.
- Changes to the `fileAnalysis` v1 schema.
