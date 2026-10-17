# Agent Control acceptance evidence design

**Date:** 2026-10-18

**Status:** Approved for implementation

## Purpose

Bring the existing real-desktop Agent Control smoke into the shared acceptance evidence system.
The smoke already exercises the same product purpose on Windows and macOS: discovery, protocol
capabilities, safe UI navigation, native screenshot capture, silent video recording and cleanup.
It should produce the same machine-readable envelope as update, Dock and live capture so one report
can show whether those desktop control paths were actually exercised for an exact commit.

This change does not weaken the release preflight. When Agent Control dependencies changed, the
existing smoke remains a blocking local gate. The shared acceptance report continues to be an
evidence index with advisory missing or stale cells, not release approval.

## Report domain

Add `agent-control` as a fourth acceptance domain. Windows and macOS are base report platforms, so
ordinary reports gain one explicit Agent Control cell for each. Linux follows the report's existing
opt-in rule: a Linux column appears only after any supplied evidence identifies itself as Linux,
and its Agent Control cell is then classified like every other Linux cell.

The report matrix becomes:

| Domain | Windows | macOS | Linux when opted in |
| --- | --- | --- | --- |
| Update | packaged update | packaged update | supplied evidence or gap |
| Dock | native reservation | native reservation | supplied evidence or gap |
| Capture | VB-Cable | BlackHole | supplied evidence or gap |
| Agent Control | desktop smoke | desktop smoke | supplied evidence or gap |

Missing Agent Control evidence is intentionally visible and advisory under the current rollout
policy. An actual target-SHA smoke failure remains blocking wherever release preflight invokes the
smoke, independently of the report's advisory policy.

## Producer behavior

`npm run smoke:agent-control` retains its current command line, UI ownership rules, artifacts and
exit behavior. A clean worktree is required before a formal run so `sourceSha` names the exact code
that produced the evidence.

The producer keeps `smoke-report.json` for compatibility and also writes `result.json` with the
shared envelope. The scenarios are:

- `discovery-and-capabilities`;
- `inspect-and-safe-start`;
- `settings-navigation`;
- `screenshot`;
- `settings-cleanup`;
- `silent-recording`.

Each scenario becomes `passed` only after the real operation and its checks complete. If execution
stops early, untouched scenarios are `notRun`; the failing scenario is `failed`; and completed
scenarios remain recorded. Failure evidence is written after best-effort cleanup and before the
original error is rethrown.

Cleanup separately records whether an owned Settings surface and active recording were left behind.
A cleanup failure makes the evidence failed even when the triggering product scenario was already
recorded. The smoke never closes a surface it did not create and never stops a recording it did not
start.

## Integrity and claims

- The evidence carries the clean source SHA, host OS/architecture/version, run time and tool version.
- Screenshot and recording paths, byte counts and SHA-256 values remain in the evidence artifacts.
- Passing proves that the advertised commands completed and returned structurally valid PNG/MP4
  artifacts. It does not certify visual appearance, video frame quality or measured-source audio.
- Contract tests on another operating system cannot substitute for native desktop evidence.
- The report consumes explicit evidence paths and never guesses the latest smoke run.

## Out of scope

- changing Agent Control commands or its public schema;
- packaged stable-identity Agent Control acceptance;
- combining UI walkthrough screenshots with this smoke;
- treating performance benchmarks as pass/fail acceptance;
- treating theme galleries as automated visual approval.

Performance tools need a baseline-comparison evidence type, while theme and UI galleries need an
explicit human-review record. Those are separate follow-ups after this deterministic smoke domain.
