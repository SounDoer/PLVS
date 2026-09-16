# Opt-In Crash Reporting Implementation Plan

**Design:** `docs/superpowers/specs/2026-09-15-crash-reporting-design.md`  
**Repositories:**

- PLVS: `C:\Users\shenxichen\repos\PLVS\.claude\worktrees\crash-reporting`
- Receiver: `C:\Users\shenxichen\repos\soundoer-newsletter`

**Goal:** Capture Rust panics and fatal React render failures locally, ask the user before sending
the exact redacted payload, add opt-in diagnostics to Feedback, and deliver accepted reports as JSON
attachments through the self-hosted receiver.

**Implementation order:** Build and verify the receiver first. Then build PLVS local capture and UI.
Deploy and smoke-test the receiver before any PLVS release containing the Send action.

## Ground rules

- Use test-first changes for each task: establish the failing contract, implement the smallest
  behavior, then run the focused tests.
- PLVS commits use Conventional Commits with a scope. Receiver commits follow the same convention.
- Do not modify `src/generated/` or `docs/agent-control/generated/` by hand.
- Keep every frontend `invoke` in `src/ipc/commands.js`; components call wrappers only.
- The crash dialog is a blocking editor while open. Test scene-operation refusal before mutation.
- The panic hook is best effort and must never panic itself.
- Do not add filesystem permissions to the WebView. Rust owns report files and log access.
- Do not enable `crash-test` in any production packaging script.
- A new PLVS worktree needs `npm run ffmpeg:fetch` before the first Rust build.
- Run `npm run check` before merge. A capture soak is unnecessary unless audio/DSP code changes.

## File map

### `soundoer-newsletter`

| File | Responsibility |
| --- | --- |
| `src/crash-report.js` | Crash request validation and handler |
| `src/feedback.js` | Optional diagnostics validation for Feedback |
| `src/email.js` | Crash summary plus JSON attachments |
| `src/server.js` | `/crash-report` route and extended `/feedback` route |
| `test/crash-report.test.js` | Validation unit tests |
| `test/feedback.test.js` | Feedback diagnostics unit tests |
| `test/email.test.js` | Attachment rendering tests |
| `test/server.test.js` | Endpoint integration tests and failure responses |
| `.env.example`, `README.md` | Endpoint and deployment documentation |

### PLVS

| File | Responsibility |
| --- | --- |
| `src-tauri/src/crash_report.rs` | Schema, redaction, storage, retention, log enrichment, panic hook |
| `src-tauri/src/ipc/commands.rs` | Crash/report/log commands exposed to the main WebView |
| `src-tauri/src/lib.rs` | Logger, reporter initialization, managed state, command registration |
| `src-tauri/Cargo.toml` | `crash-test` feature |
| `src/ipc/commands.js` | Typed frontend wrappers for crash commands |
| `src/lib/crashReporting.js` | Request construction, timeout, endpoint client, error normalization |
| `src/lib/feedback.js` | Optional diagnostics request payload |
| `src/components/AppCrashBoundary.jsx` | Main-root Error Boundary and reload fallback |
| `src/components/CrashReportDialog.jsx` | Preview, note/email, Send/Don't Send/Don't Ask Again |
| `src/hooks/useCrashReporting.js` | Pending-report lifecycle and global JS log listeners |
| `src/hooks/useCrashReportSetting.js` | Persisted setting plus Rust atomic synchronization |
| `src/main.jsx` | Wrap only the main surface in the Error Boundary |
| `src/App.jsx` | Mount crash lifecycle inside app providers |
| `src/components/AppSettingsOverlays.jsx` | Render the crash dialog and pass settings through |
| `src/components/SettingsPanel.jsx` | `Ask To Send Crash Reports` switch |
| `src/components/FeedbackDialog.jsx` | `Attach Diagnostics` checkbox and preview copy |
| `README.md`, `docs/prd.md` | User-initiated diagnostics privacy language |
| `scripts/tauriDependencyContract.test.js` or a focused new script test | Production commands exclude `crash-test` |

Tests live next to the PLVS source they cover and use `/** @vitest-environment jsdom */` for React
or persistence tests. Do not use jest-dom matchers.

---

## Task 1: Receiver endpoint and attachments

**Repository:** `soundoer-newsletter`

- [ ] Add failing unit tests in `test/crash-report.test.js` for:
  - valid schema-v1 report with no note/email;
  - valid optional note and email;
  - missing/non-object report;
  - unsupported schema version;
  - serialized report above 256 KiB;
  - note above 2,000 characters;
  - malformed email;
  - send callback failure propagation.
- [ ] Add failing email tests asserting:
  - subject identifies PLVS crash type and version;
  - JSON attachment name is `plvs-crash-<id>.json`;
  - attachment content parses to exactly the accepted report object;
  - optional email becomes `Reply-To`;
  - note is in the mail summary, not injected into the attachment.
- [ ] Add failing server tests for `POST /crash-report`:
  - 200 `{ ok: true }` and one mail on success;
  - 400 for each validation class;
  - non-2xx when `sendMail` rejects;
  - allowed-origin behavior continues to be supplied by the existing CORS registration.
- [ ] Extend Feedback tests first: optional diagnostics is accepted up to 128 KiB and attached as
  `plvs-diagnostics.json`; malformed or oversized diagnostics returns 400; old clients without it
  remain unchanged.
- [ ] Implement `src/crash-report.js` as pure validation plus an injected send callback, matching
  the existing `feedback.js` style.
- [ ] Extend `email.js`, `feedback.js`, and `server.js`. Do not store crash data in SQLite or log the
  request body.
- [ ] Document `/crash-report`, Feedback diagnostics, size limits, and deployment smoke procedure in
  `README.md` and `.env.example` comments.
- [ ] Run `npm test` in `soundoer-newsletter`.
- [ ] Commit in the receiver repository:
  `feat(crash): accept opt-in PLVS crash reports`.

**Deployment gate:** The code may be implemented now, but production deployment and the synthetic
attachment check must complete before Task 7's PLVS release validation.

---

## Task 2: Rust report model, storage, redaction, and retention

**Repository:** PLVS

- [ ] Create `src-tauri/src/crash_report.rs` with failing tests for:
  - schema-v1 Rust and frontend report serialization;
  - ID/filename ordering and safe characters;
  - Windows home paths with `\` and `/`, case-insensitive redaction;
  - macOS home-path redaction;
  - redaction before the final JSON is written;
  - atomic completion (no final filename until commit);
  - shared newest-five retention across `pending/` and `suppressed/`;
  - newest pending selection;
  - corrupt and future-schema files not blocking valid reports;
  - discard by exact validated report ID without path traversal;
  - final 200-line session log extraction across rotated segments.
- [ ] Implement `CrashReport`, error/location/app metadata structs, and `CrashKind` with camelCase
  JSON using existing `serde`/`serde_json`.
- [ ] Generate timestamped IDs from UTC time plus random bytes using existing `time` and
  `getrandom`; do not add a UUID dependency.
- [ ] Use existing `atomic-write-file` for completed artifacts and `app_log_dir/crash/{pending,
  suppressed}` for storage.
- [ ] Implement `CrashReporterState` with:
  - log/crash paths;
  - session ID;
  - `AtomicBool` prompt snapshot;
  - an atomic panic re-entry guard;
  - app version/OS/architecture metadata.
- [ ] Implement best-effort log enrichment on healthy startup. Never read log files from the panic
  hook.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml --all` and focused
  `cargo test --manifest-path src-tauri/Cargo.toml crash_report`.
- [ ] Commit: `feat(crash): add local crash report storage`.

---

## Task 3: Release logging, panic hook, IPC, and test injection

**Repository:** PLVS

- [ ] Add integration-oriented Rust tests or extracted pure-function tests for:
  - default prompt preference when the stored key is absent;
  - boot setting parsing from `plvs:settings`;
  - preference updates changing the reporter's atomic snapshot;
  - frontend report input normalization and size bounds;
  - frontend log input never creating a crash artifact.
- [ ] Enable `tauri-plugin-log` for GUI debug and release builds with `Info` level, log-directory
  output, finite size-based rotation, and a session marker/identifier. Keep non-GUI modes out of the
  initialization path.
- [ ] In `lib.rs` setup, after the existing store boot read provides `plvs:settings`:
  - initialize and manage `CrashReporterState`;
  - install the panic hook;
  - enrich/prune old reports without failing startup;
  - log the current session marker.
- [ ] In the panic hook, use only captured reporter state. Write message, location, and a
  best-effort forced backtrace. Guard recursion and swallow all report-write errors.
- [ ] Add the required comment explaining why allocation and filesystem I/O are acceptable when the
  hook runs on an audio callback thread: the abort is already terminal and the callback will not
  resume.
- [ ] Add Rust commands for:
  - recording a frontend render crash;
  - logging an ordinary frontend error;
  - reading the newest enriched pending report;
  - discarding an exact report;
  - updating the prompt preference snapshot;
  - reading Feedback diagnostics.
- [ ] Register commands in `lib.rs` and wrappers in `src/ipc/commands.js`, with wrapper unit tests
  asserting command names and payload shapes.
- [ ] Add `crash-test = []` to Cargo features. Under that feature only, honor
  `PLVS_TEST_PANIC=main|thread`. Production npm/Tauri build commands remain unchanged.
- [ ] Add a repository contract test that fails if a shipping command enables `crash-test`.
- [ ] Verify panic-hook chaining in debug. Preserve useful console output without double-calling a
  hook or recursing.
- [ ] Run focused Rust/IPC/config tests and clippy.
- [ ] Commit: `feat(crash): capture panics and expose report IPC`.

---

## Task 4: React render boundary and ordinary JS logging

**Repository:** PLVS

- [ ] Create failing `AppCrashBoundary.test.jsx` cases for:
  - healthy children render unchanged;
  - a render throw displays `PLVS Encountered an Error` and `Reload`;
  - exactly one frontend crash command is issued for repeated fallback renders;
  - error name/message/stack and React component stack are normalized;
  - Reload calls `window.location.reload()`;
  - report-write failure does not break the fallback.
- [ ] Implement a class Error Boundary in `src/components/AppCrashBoundary.jsx`. Keep its fallback
  independent of application providers and complex overlays.
- [ ] Wrap only the main `App` root in `src/main.jsx`; leave `DockHeaderApp` and `DockEditorApp`
  unchanged.
- [ ] Add failing tests for global `error` and `unhandledrejection` listeners in
  `useCrashReporting.test.jsx`. Assert non-`Error` rejection values normalize safely and only call
  the log command.
- [ ] Implement listener setup/cleanup in `useCrashReporting`; browser development falls back to
  `console.error` and never attempts Tauri IPC.
- [ ] Run the focused Vitest files, format, and lint affected frontend files.
- [ ] Commit: `feat(crash): capture fatal React render failures`.

---

## Task 5: Prompt preference and crash-report dialog

**Repository:** PLVS

- [ ] Add failing hook tests for `useCrashReportSetting`:
  - absent key defaults true;
  - persisted false remains false;
  - a change writes `settingsStore` and synchronizes Rust;
  - Rust synchronization failure is surfaced without silently lying about persisted state.
- [ ] Add failing `CrashReportDialog.test.jsx` cases for:
  - expandable preview displays the final request JSON;
  - note/email changes update that preview;
  - invalid email blocks Send;
  - Send success discards locally and closes;
  - Send/network/timeout failure keeps the report and draft;
  - Don't Send discards and closes;
  - Don't Ask Again discards, persists false, and closes;
  - ordinary close/application exit does not discard.
- [ ] Add `submitCrashReport` tests in `src/lib/crashReporting.test.js` for the 15-second abort,
  exact endpoint/payload, 2xx success, non-2xx failure, and network failure.
- [ ] Implement the setting hook, endpoint client, dialog, and lifecycle wiring. Show at most the
  newest report after normal App startup.
- [ ] Call `useBlockingEditor("crash-report", open)` from the dialog/lifecycle owner.
- [ ] Extend scene-operation tests so preset apply/save/update and Dock entry are refused while the
  crash dialog is open, and assert no state mutation occurs before refusal. Include an Agent Control
  path because it can operate behind a visible modal.
- [ ] Add `Ask To Send Crash Reports` to Settings using existing switch/label conventions. Keep
  user-facing Title Case and lowercase `aria-label` conventions.
- [ ] Run focused React, persistence, scene-operation, and Agent Control tests.
- [ ] Commit: `feat(crash): ask before sending saved reports`.

---

## Task 6: Opt-in Feedback diagnostics and privacy text

**Repository:** PLVS

- [ ] Extend `src/lib/feedback.test.js` first:
  - unchecked behavior sends the legacy payload;
  - checked behavior sends the exact diagnostics object returned by Rust;
  - diagnostics-read failure does not send a falsely checked request and produces a useful UI error.
- [ ] Extend `FeedbackDialog.test.jsx` first for the unchecked default, user-visible explanation,
  checked submission, loading state, and retry behavior.
- [ ] Implement `Attach Diagnostics` in `FeedbackDialog.jsx`, fetching diagnostics only when the user
  opts in. Browser development may report diagnostics unavailable without disabling Feedback.
- [ ] Extend `submitFeedback` to accept optional diagnostics while preserving old callers.
- [ ] Update README's privacy bullet and PRD privacy statement:
  - audio stays on device;
  - no default telemetry;
  - update checks remain automatic;
  - Feedback diagnostics and crash reports are sent only after an explicit user action.
- [ ] State explicitly that audio samples are never attached.
- [ ] Run Feedback tests plus documentation/config contract tests.
- [ ] Commit: `feat(feedback): attach diagnostics only on request`.

---

## Task 7: Full verification, receiver deployment, and release-profile crash smoke

### Automated gates

- [ ] In `soundoer-newsletter`, run `npm test` and confirm a clean worktree.
- [ ] In PLVS, run `npm run check` and confirm a clean worktree.
- [ ] Confirm the PLVS dependency/config contract proves production scripts do not enable
  `crash-test`.

### Receiver deployment gate

- [ ] Push/deploy the receiver commit using its documented VPS workflow.
- [ ] Restart `soundoer-newsletter` because `src/` changed.
- [ ] Send one synthetic, non-sensitive schema-v1 fixture to the production endpoint.
- [ ] Confirm the email arrives with the expected JSON attachment and no raw request printed in
  service logs.
- [ ] Confirm malformed and oversized fixtures return 400 without email.

### Release-profile local smoke

- [ ] Build a release-profile test binary with `--features crash-test` without changing production
  package scripts. Keep its output separate from the normal release binary if necessary to avoid
  replacing the dev-identity GUI.
- [ ] Run with `PLVS_TEST_PANIC=main`; verify abort and one complete pending JSON file.
- [ ] Relaunch without the variable; verify the panel, 200-line maximum, and home-path redaction.
- [ ] Simulate endpoint failure; verify the report remains pending with the user's draft.
- [ ] Send successfully; verify the local file is deleted only after 2xx.
- [ ] Repeat with `PLVS_TEST_PANIC=thread`.
- [ ] Trigger a controlled React render failure; verify fallback, Reload, and next-launch prompt.
- [ ] Disable asking, trigger a test crash, re-enable asking, and verify the suppressed report never
  becomes a historical prompt.
- [ ] Create more than five mixed pending/suppressed reports and verify deterministic oldest-first
  eviction.
- [ ] Confirm the distributed production binary ignores `PLVS_TEST_PANIC` because the feature is
  absent.

### Final review

- [ ] Review the report preview against the captured HTTP request; fields must match exactly.
- [ ] Review the emailed attachment against the previewed `report` object.
- [ ] Verify Windows and macOS path redaction fixtures.
- [ ] Verify no audio samples, settings snapshot, workspace, presets, themes, or Agent Control state
  are included.
- [ ] Record the production endpoint verification in the release checklist before shipping PLVS.

## Expected commit sequence

Receiver repository:

1. `feat(crash): accept opt-in PLVS crash reports`

PLVS repository:

1. `feat(crash): add local crash report storage`
2. `feat(crash): capture panics and expose report IPC`
3. `feat(crash): capture fatal React render failures`
4. `feat(crash): ask before sending saved reports`
5. `feat(feedback): attach diagnostics only on request`
6. Any narrow follow-up fixes discovered by full verification

