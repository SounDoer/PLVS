# Unified acceptance report design

**Date:** 2026-10-18

**Status:** Approved for implementation

## Purpose

Combine the real-machine acceptance evidence for updates, Dock and live capture into one report
that is readable by a person and stable enough for automation. The report answers four questions:

1. What exact source commit was assessed?
2. Which domain and platform combinations have passing evidence?
3. Which evidence is missing, stale, manual or failed?
4. Where are the original immutable evidence files?

The report is an evidence index and verdict calculator. It does not rerun destructive or long-lived
acceptance scenarios, install drivers, launch packaged updates, or silently select whatever file
happens to be newest.

## User-facing form

The command accepts explicit evidence files and writes both JSON and Markdown:

```text
npm run acceptance:report -- \
  --target <git-sha> \
  --evidence <update-result.json> \
  --evidence <dock-result.json> \
  --evidence <capture-result.json>
```

When `--target` is omitted, the current `HEAD` is used. The default output directory is an ignored
timestamped directory below `artifacts/acceptance-report/`. `--out-dir` selects another contained
or explicit destination without changing the source evidence.

The JSON is the machine contract. The Markdown presents the same facts as a compact matrix and a
list of required follow-ups.

## Evidence envelope

New Dock and capture runs emit a common top-level envelope. Existing update evidence already has
the required shape and remains unchanged:

```json
{
  "schemaVersion": 1,
  "domain": "capture",
  "runId": "...",
  "sourceSha": "40 hexadecimal characters",
  "platform": { "os": "macos", "arch": "aarch64", "version": "..." },
  "tool": { "name": "capture-smoke", "version": 1 },
  "startedAt": "...",
  "endedAt": "...",
  "summary": "complete",
  "scenarios": [{ "id": "live-file-agreement", "status": "passed" }],
  "artifacts": [],
  "cleanup": { "status": "passed", "observations": [] },
  "warnings": []
}
```

The report validates structure, known domains and statuses, exact SHA shape, unique scenario ids,
platform identity and cleanup. Evidence paths are recorded relative to the generated report where
possible, but original files are never copied or rewritten.

## Coverage matrix

The base report owns these six cells:

| Domain | Windows | macOS |
| --- | --- | --- |
| Update | packaged update acceptance | packaged update acceptance |
| Dock | native reservation acceptance | native reservation acceptance |
| Capture | VB-Cable live capture | BlackHole live capture |

The evidence contract also recognizes Linux. To avoid inventing gaps for a platform that is not
yet part of the product branch, Linux stays absent from the matrix until at least one supplied
evidence file identifies `platform.os` as `linux`. The report then adds a Linux column for all three
domains in the stable Windows, macOS, Linux order. Supplied cells are classified normally and the
remaining Linux cells become explicit `missing` gaps. This lets a rebased Linux branch adopt one
producer at a time without changing the schema or overstating untested coverage.

Each cell has one of these states:

- `passed`: complete evidence for the target SHA;
- `failed`: target-SHA evidence contains an automated failure or failed cleanup;
- `incomplete`: target-SHA evidence exists but required work did not complete;
- `stale`: evidence belongs to a different source SHA;
- `missing`: no evidence was supplied for the cell;
- `unsupported`: the product explicitly has no equivalent on that platform.

Duplicate evidence for one cell is rejected unless all but one are stale and exactly one matches
the target SHA. This prevents arbitrary last-file-wins behavior.

## Advisory gaps and blocking failures

The user decision for the current rollout is preserved: missing Windows hardware evidence does not
block work, but it must be prominent. Therefore the report has two independent outputs:

- `verdict`: `passed`, `failed`, or `incomplete` based on supplied target-SHA automated evidence;
- `ready`: false only for an actual target-SHA failure. Missing, stale and incomplete coverage are
  advisory gaps and produce `ready: true` with `verdict: incomplete`.

This is not a release-gate bypass. Stable release policy may independently require particular
cells, and the report must not claim release readiness. Its wording is “acceptance evidence ready
with gaps,” not “release approved.”

## Integrity and provenance

- Every evidence item names the exact source SHA that produced it.
- The report records its own generation SHA, time, host platform and tool version.
- Existing artifact hashes are preserved and displayed but not re-signed.
- Update evidence continues to use its dedicated verifier for receipt and artifact integrity.
- The aggregator validates the common envelope but does not pretend to reproduce a domain-specific
  verifier's stronger checks.
- Absolute source paths may appear in local JSON for usability; Markdown uses relative links when
  the files share a repository tree.

## Changes to producers

Capture smoke writes a result even on an assertion failure or rig-unavailable outcome, after
cleanup. Its existing exit codes remain 0 for pass, 1 for product failure and 2 for rig failure.

The macOS Dock integration writes the common envelope next to its existing raw `results.json`.
Future Windows Dock acceptance should emit the same envelope. Existing raw artifacts remain useful
debugging evidence and are not migrated in place.

Update acceptance is consumed as-is. Its intentional manual scenarios remain warnings rather than
being rewritten as automated failures.

## Out of scope

- running every acceptance tool through one monolithic command;
- declaring a stable release approved;
- manufacturing a source SHA for old Dock or capture files that never recorded one;
- uploading, publishing or signing evidence;
- the Agent Control smoke and performance rigs in the first version. They can adopt the envelope
  after this three-domain contract has proved stable.
