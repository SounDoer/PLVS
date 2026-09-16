# Opt-In Crash Reporting

**Date:** 2026-09-15  
**Status:** Approved  
**Repositories:** `PLVS`, `soundoer-newsletter`

## Summary

Add a local-first crash-reporting path for PLVS. Version 1 captures Rust panics and fatal React
render failures, stores a redacted JSON report on the user's machine, and asks on the next normal
launch whether the user wants to send it. Nothing is uploaded without an explicit user action.

The report is delivered to a new `POST /crash-report` endpoint in the self-hosted
`soundoer-newsletter` service. The service validates the request and emails the JSON report to the
maintainer as an attachment. PLVS also gains an opt-in `Attach Diagnostics` option in the existing
Feedback dialog for non-crash problems.

This is deliberately not a general telemetry system. It does not collect background analytics,
automatically upload reports, or introduce a third-party crash service.

## Motivation

PLVS currently loses the evidence needed to investigate a release crash:

- `tauri-plugin-log` is registered only under `debug_assertions`, so release builds do not retain a
  local application log.
- the release profile uses `panic = "abort"`; a Rust panic terminates the process without a crash
  artifact;
- the React root has no Error Boundary, and there are no global `error` or `unhandledrejection`
  listeners;
- release binaries are stripped, so a release backtrace is normally address-only;
- the Feedback dialog depends on the user noticing the failure, reopening the app, and describing
  the relevant state from memory.

The product promises no default telemetry. Crash evidence must therefore be captured locally first,
shown to the user, and sent only after consent.

## Goals

- Preserve actionable evidence for Rust panics in release-profile builds.
- Replace a fatal React white screen with a stable reload surface and a local crash report.
- Keep ordinary JavaScript errors visible in file logs without treating every exception as a crash.
- Let the user inspect exactly what will be sent, add context, and choose `Send`, `Don't Send`, or
  `Don't Ask Again`.
- Retain failed uploads for a later retry without growing local storage indefinitely.
- Let a user explicitly attach lightweight diagnostics to ordinary Feedback.
- Keep the implementation self-hosted and consistent with PLVS's privacy positioning.

## Non-goals

Version 1 does not capture:

- access violations, segmentation faults, or other native faults that bypass the panic hook;
- WebView2, WKWebView, Core Audio, or operating-system crashes;
- hangs or stalls, which require a watchdog and a separate product definition;
- FFmpeg sidecar failures;
- `plvs-cli`, capture-harness, or other non-GUI binary modes;
- automatic crash grouping, dashboards, symbolication, or analytics;
- automatic uploads or an `Always Send` preference.

If PLVS later receives credible reports of the process disappearing without a local report, that is
the signal to evaluate minidumps, Crashpad, or Sentry as a separate design.

## User Experience

### Fatal React render failure

The main React surface is wrapped in an Error Boundary. If a descendant throws during rendering,
the normal app surface is replaced with a small, dependency-light fallback containing:

- `PLVS Encountered an Error`;
- a short explanation that a local report was saved;
- a `Reload` button.

The boundary records one `frontend_render` report. Repeated renders of the fallback must not create
duplicate reports. Dock accessory roots are outside v1 because their failure does not produce the
main-window white-screen failure this feature is intended to address.

### Next-launch crash panel

After the main window completes normal startup, PLVS checks for a prompt-eligible report. If the
`Ask To Send Crash Reports` setting is enabled, the newest report is displayed in a modal panel:

- title: `PLVS Quit Unexpectedly`;
- plain-language explanation;
- expandable report preview;
- optional user note;
- optional reply email;
- `Send`, `Don't Send`, and `Don't Ask Again` actions.

The preview is generated from the same final request object that `Send` submits. User note and email
changes are therefore reflected in the preview; there is no hidden payload.

Actions have these meanings:

- **Send:** submit the report. Delete the local report only after a 2xx response.
- **Don't Send:** delete the current local report.
- **Don't Ask Again:** delete the current report and persist
  `askToSendCrashReports = false`.

Closing the application while the panel is open is not a decision. The report remains pending and
is offered again next launch.

Only one report is shown per launch. Additional pending reports remain bounded by retention and can
be offered on later launches.

Because the panel contains a draft note with send/cancel semantics, it registers through
`useBlockingEditor` while open. Scene operations must be refused before mutation even when the note
is still empty; tray and Agent Control entry points must not route around the modal.

### Preference semantics

`Ask To Send Crash Reports` appears in Settings and defaults to on.

When it is off, crashes are still written locally for diagnosis on the same machine, but they are
marked non-prompting. Turning the setting back on affects future crashes only; it must not surface a
backlog of historical suppressed reports.

The Rust crash reporter owns a session-local atomic snapshot of this preference. It is initialized
from the persisted boot settings before the main window runs and updated through a command in
`src/ipc/` whenever the React setting changes. Both Rust and frontend crash capture consult this Rust
snapshot when choosing `pending` versus `suppressed`. This avoids parsing the shared settings file
inside a panic hook and preserves the preference value that was active at the instant of the crash.

There is intentionally no `Always Send` option in v1. Every transmitted crash report requires an
explicit `Send` click.

### Feedback diagnostics

The existing Feedback dialog gains an `Attach Diagnostics` checkbox, off by default. When checked,
the request includes a diagnostic object containing:

- PLVS version;
- operating system and architecture;
- the current session's recent log tail.

Feedback remains usable in browser development, where diagnostics may be unavailable. The UI says
what will be attached and does not silently enable the option.

The existing `/feedback` request gains an optional versioned `diagnostics` object. The service
validates it independently from the feedback text and attaches it as `plvs-diagnostics.json`; it
does not insert a potentially large log tail into the message body.

## Crash Categories

| Category | Capture path | Creates next-launch prompt |
| --- | --- | --- |
| Rust panic | process-wide panic hook | Yes |
| React render failure | root Error Boundary | Yes |
| Ordinary `window.error` | frontend log bridge | No |
| Unhandled promise rejection | frontend log bridge | No |
| Native process fault | not captured in v1 | No report |
| Hang | not captured in v1 | No report |

The distinction between a render crash and an ordinary JavaScript exception is deliberate. Prompting
for recoverable errors would train users to dismiss the crash panel and reduce the value of consent.

## Local Logging

`tauri-plugin-log` is enabled for GUI release builds as well as debug builds. Logs are written under
Tauri's application log directory and bounded by size-based rotation. The implementation must set a
finite total retained size rather than relying on an unbounded `KeepAll` policy.

Each GUI launch has a session identifier and an unambiguous session boundary in the file logs. A
crash report records that session identifier. On the next launch, PLVS reads the previous session's
rotated segments, takes at most the final 200 lines belonging to the crashed session, redacts them,
and adds them to the report before it is shown or sent.

The panic hook does not scan or copy log files. It writes only the minimum crash artifact. Reading
and enriching logs happens during the next healthy startup, where allocation and I/O failures can be
handled normally.

Ordinary frontend errors are forwarded through a command defined in `src/ipc/`; components do not
call Tauri `invoke` directly. The Rust command records them through the same logging backend.

## Rust Panic Capture

PLVS installs one process-wide panic hook during GUI initialization. The hook records:

- report schema version and a unique report ID;
- crash kind `rust_panic`;
- timestamp and session ID;
- PLVS version, target OS, and architecture;
- panic payload when it can be represented as text;
- `PanicHookInfo::location()` file, line, and column;
- a best-effort forced backtrace.

The hook writes a temporary file and renames it to its final `.json` name so startup does not consume
a partially written report. A process-wide atomic guard prevents recursive or concurrent panics from
producing conflicting artifacts. Every hook operation is best effort: failure to write a report must
not replace the original panic with another panic.

The release build remains stripped. Source location is compiled into ordinary panic call sites and
is the primary v1 locator; a stripped backtrace may contain only addresses. PDB/dSYM archival and
offline symbolication can be added later without changing the report schema.

A panic may originate on an audio callback thread. The hook is allowed to allocate and perform file
I/O in that terminal path because the process is already aborting and no audio callback will return
to normal operation. The implementation must include this rationale in a code comment so the hook
is not later removed as an apparent violation of the realtime-safety rule.

The previous panic hook is not called after the crash artifact is written when doing so risks
duplicated output or re-entrancy. Debug behavior must remain useful, so the implementation plan must
verify console output in development before selecting the final chaining behavior.

## Frontend Capture

The Error Boundary sends a serializable error snapshot to a new crash-report command in
`src/ipc/commands.js`. The Rust side owns file paths, atomic writes, retention, and redaction. The
frontend does not receive filesystem permissions.

The snapshot contains:

- error name and message;
- JavaScript stack when available;
- React component stack when available;
- current PLVS version and surface identifier.

The boundary must remain able to render if application providers, persistence, or the normal design
system failed. Its fallback should avoid depending on `AppContent`, runtime providers, or a complex
overlay stack.

Global `error` and `unhandledrejection` listeners are installed only for logging. They normalize
non-`Error` rejection values and must never throw while reporting an error.

## Report Storage and Lifecycle

Crash storage lives below the application log directory:

```text
crash/
  pending/       reports eligible for a prompt, including failed sends
  suppressed/    reports created while asking is disabled
```

Reports are individual JSON files named with a sortable timestamp and unique ID. The two directories
share one retention limit: the newest five reports are kept and older reports are deleted.

Lifecycle:

```text
crash occurs
  ├─ asking enabled  ─▶ pending
  └─ asking disabled ─▶ suppressed

pending
  ├─ Send + 2xx      ─▶ delete
  ├─ Send failure    ─▶ keep pending
  ├─ Don't Send      ─▶ delete
  └─ Don't Ask Again ─▶ delete + disable asking
```

Reports found with an unsupported future schema are retained but not shown or sent. Corrupt files
are quarantined or removed with a warning; one bad file must not prevent PLVS from starting.

## Report Schema and Redaction

The stored report has a versioned envelope. A representative shape is:

```json
{
  "schemaVersion": 1,
  "id": "...",
  "createdAt": "2026-09-15T12:34:56.000Z",
  "sessionId": "...",
  "kind": "rust_panic",
  "app": { "version": "0.15.4", "os": "windows", "arch": "x86_64" },
  "error": {
    "message": "...",
    "location": { "file": "src/audio/capture.rs", "line": 428, "column": 17 },
    "stack": "..."
  },
  "logs": ["..."]
}
```

Redaction is applied at the Rust serialization boundary and again when enriching old reports, not
only in the UI. Windows and macOS home-directory spellings are replaced with `~`, including slash
and backslash variants and case-insensitive Windows matches. The raw home path must never be written
into the final report JSON.

Logs can still contain filenames, audio-device labels, and user-authored values. Those are not
silently stripped in v1 because doing so generically would destroy diagnostic value. The report
preview is the final privacy boundary: users can inspect the exact payload before sending.

The optional email and user note are request metadata added only after the user enters them. They are
not present in the automatic local crash artifact.

## Upload Contract

PLVS sends:

```http
POST https://list.plvs.soundoer.com/crash-report
Content-Type: application/json
```

The request body contains:

```json
{
  "report": { "schemaVersion": 1 },
  "note": "optional user note",
  "email": "optional@example.com"
}
```

The client uses a 15-second timeout and treats network errors, timeouts, and non-2xx responses as
failures. It keeps the local report and shows a retryable error. A successful response is
`200 { "ok": true }`.

The service validates:

- JSON object shape and schema version;
- a maximum serialized report size of 256 KiB;
- a maximum note length of 2,000 characters;
- optional email format;
- allowed request origin through the existing CORS policy;
- the existing per-IP rate limit.

It does not persist reports in SQLite. It renders a short mail summary and attaches the accepted
report as `plvs-crash-<id>.json` with `application/json`. The optional user email becomes `Reply-To`.
The attachment contains the same report object shown in PLVS.

Mail-send failure produces a non-2xx response, so PLVS retains the pending report. Server logs must
not print the full report body.

`POST /feedback` keeps its existing content and email rules and accepts an optional diagnostics
object capped at 128 KiB. Malformed or oversized diagnostics reject the request with 400 rather than
silently sending feedback without an attachment. Feedback without diagnostics remains backward
compatible.

The endpoint must be deployed and verified before a PLVS release containing the crash panel. The
deployment check sends a synthetic, non-sensitive fixture and confirms that the expected attachment
arrives before the desktop release proceeds.

## Privacy and Product Language

README's current claim that PLVS makes no network calls except update checks is no longer literally
true. It becomes a statement that audio stays on device, there is no default telemetry, and network
diagnostics are sent only when the user explicitly chooses to send Feedback or a crash report.

The PRD receives the same distinction between default telemetry and user-initiated diagnostics.
Audio samples are never included in reports or diagnostics.

## Test-only Panic Injection

End-to-end validation must exercise the real release panic behavior. Add a dedicated Cargo feature,
for example `crash-test`, that recognizes:

```text
PLVS_TEST_PANIC=main
PLVS_TEST_PANIC=thread
```

The test feature is built with the release profile so `panic = "abort"` and stripping match the
shipping behavior. The production release commands must not enable this feature; the distributed
binary therefore has no environment-variable crash trigger.

`main` triggers a panic during controlled GUI startup. `thread` triggers one on a named background
thread. A manual end-to-end run verifies report creation, next-launch enrichment, preview, sending,
deletion after success, and retention after a simulated network failure.

## Verification

Automated coverage includes:

- Rust tests for schema serialization, home-path redaction, atomic file completion, retention across
  both storage classes, corrupt/future reports, and pending-report selection;
- frontend tests for Error Boundary fallback, single-report creation, Reload, panel actions,
  preference semantics, blocking of scene operations before mutation, failed-send retry, and
  diagnostics opt-in;
- IPC contract tests for the new commands;
- `soundoer-newsletter` tests for validation, size limits, attachment content, Reply-To, rate-limit
  compatibility, and mail-send failure responses;
- existing README/PRD and Tauri configuration contract tests as applicable.

Manual release-profile verification includes:

1. trigger `PLVS_TEST_PANIC=main` in a `crash-test` build;
2. verify the process aborts and one complete JSON report exists;
3. relaunch without the variable and verify the previous session's final log lines appear;
4. inspect the displayed payload and confirm home paths are redacted;
5. send to a local or staging endpoint and inspect the received attachment;
6. repeat with `thread`;
7. simulate an unavailable endpoint and verify the report remains pending;
8. create more than five reports and verify deterministic oldest-first eviction;
9. disable asking, trigger a crash, and verify no historical prompt appears after re-enabling;
10. trigger a React render failure and verify the fallback and next-launch panel.

This feature does not modify the audio capture or DSP pipeline. A capture soak is therefore not
required unless implementation work unexpectedly touches those directories.

## Deployment Order

1. Implement and test `POST /crash-report` in `soundoer-newsletter`.
2. Deploy the service and verify delivery with a synthetic fixture.
3. Implement PLVS local logging, capture, UI, privacy text, and test-only panic injection.
4. Run both repositories' full test suites and PLVS `npm run check`.
5. Perform release-profile panic and upload verification.
6. Release PLVS only after the production endpoint has passed the attachment test.

## Separate Investigation of the Original User Report

The feature request does not establish that the reporting user experienced a real crash. If the
original feedback describes an actual disappearance, white screen, or reproducible failure, track it
as a separate bug using the original wording, environment, timing, and reproduction steps. Adding
future crash evidence is not itself a fix for that incident.
