# Unified acceptance report implementation plan

**Date:** 2026-10-18

**Design:** `docs/history/specs/2026-10-18-unified-acceptance-report-design.md`

## 1. Define and test the common evidence contract

- Add a JavaScript library that validates the shared envelope, normalizes operating-system and
  architecture names, counts scenarios and classifies one evidence item against a target SHA.
- Reject malformed timestamps, SHA values, duplicate scenario ids, unknown statuses and failed
  cleanup that attempts to present itself as complete.
- Keep update-specific integrity verification in the existing update verifier.

## 2. Build the report aggregator

- Parse repeatable `--evidence`, optional `--target` and optional `--out-dir` arguments.
- Build the base update/Dock/capture × Windows/macOS matrix without scanning directories.
- Accept Linux evidence and add a complete Linux column only after a supplied evidence file opts
  that platform into the report.
- Reject ambiguous duplicate target-SHA evidence.
- Write atomic `report.json` and `report.md` files with the same verdict, gaps and source paths.
- Exit 1 only for actual target-SHA automated failures, 2 for invalid input/tooling problems, and 0
  for pass or explicitly advisory missing/stale evidence.

## 3. Upgrade evidence producers

- Make capture smoke retain its current console output and exit codes while also writing a common
  result after cleanup. Include metric comparisons, source format, dropped chunks and the selected
  rig route as scenario observations.
- Make the macOS Dock integration write a common result beside raw geometry results. Include every
  scenario, cleanup outcome, exact source SHA and host platform.
- Consume update acceptance without changing its schema or verifier.

## 4. Document and expose the workflow

- Add `npm run acceptance:report`.
- Document explicit evidence selection, advisory Windows gaps and the difference between this
  report and release approval in `CONTRIBUTING.md`.
- Keep all generated reports below ignored `artifacts/` by default.

## 5. Verify and commit

1. Run focused unit tests for evidence validation, matrix classification, Markdown parity and CLI
   argument handling.
2. Run capture smoke on the current macOS BlackHole rig and confirm the new result file.
3. Generate a real report combining current capture evidence with the latest update and Dock
   evidence; confirm stale and missing cells are explicit and non-blocking.
4. Run `npm test`, `npm run format:check`, `npm run lint`, `npm run typecheck` and
   `npm run rust:check` before the implementation commit.
5. Commit the docs separately from implementation, using scoped Conventional Commits.

The existing four-hour soak remains a separate long-run artifact. Adding soak summaries to the
matrix is a follow-up after the smoke-report contract is stable.
