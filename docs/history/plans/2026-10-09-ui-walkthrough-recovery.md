# UI Walkthrough Recovery — Implementation Plan

**Goal:** Make the repository's Agent Control UI walkthrough scenario-isolated, journaled, and
recoverable after interruption without adding a public transaction CLI.

**Spec:** `docs/history/specs/2026-10-09-ui-walkthrough-recovery-design.md`

## Delivery rules

- Work on `main`; do not create a branch or worktree without user approval.
- Preserve Manifest version 1 and the existing ordinary invocation.
- Build recovery only from current public Agent Control operations and development fixture tokens.
- Never restore an externally diverged field, adopt a replacement resource, or add a force mode.
- Write the journal before each side effect and use atomic replacement.
- Restore and verify one scenario before starting the next.
- Keep runtime outputs under ignored `artifacts/`; commit no generated run journal or screenshot.
- Before each commit run `npm test` plus touched-side checks. Run `npm run check` before merge or
  push and before final delivery of this main-branch change.

## Phase 1 — Planning and ownership primitives

1. Extract Manifest-to-plan projection from `ui-visual-walkthrough-lib.mjs` without changing the
   accepted Manifest.
2. Add pure resource keys and field ownership classification:
   `alreadyRestored`, `owned`, and `diverged`.
3. Build per-scenario restoration ledgers from fresh family snapshots instead of one suite ledger.
4. Add tests proving repeated touches restore the first value inside one scenario and scenarios do
   not share baselines.

**Commit:** `refactor(tooling): plan isolated ui walkthrough scenarios`

## Phase 2 — Persistent run journal

1. Add `scripts/ui-walkthrough/journal.mjs` with schema validation and legal phase transitions.
2. Persist through a same-directory temporary file and rename; restrict permissions where
   supported.
3. Record Manifest hash, exact instance, application identity, initial tokens, scenario phases,
   resources, intents, observations, and failures.
4. Add fault-injection tests for a process ending before and after each recorded intent/result.

**Commit:** `feat(tooling): journal ui walkthrough recovery state`

## Phase 3 — Scenario-scoped execution

1. Extract a runner that prepares, captures, dismisses, restores, and verifies one scenario.
2. Keep the deterministic Transport audio fixture at suite scope.
3. Move Settings/View durable restoration to the end of each scenario.
4. Journal exact surfaces, draft/decision generations, fixtures, sessions, and screenshot metadata.
5. On ordinary failures, clean only resources whose exact ownership is known; preserve uncertain
   draft and event states with actionable evidence.
6. Keep existing success reports compatible while adding per-scenario restoration detail.

**Commit:** `refactor(tooling): isolate ui walkthrough cleanup`

## Phase 4 — Status and interrupted recovery

1. Add `--plan`, `--status <run.json>`, and `--recover <run.json>` parsing to the existing entry.
2. Implement reverse-order resource reconciliation through closed adapters.
3. On revision conflict, re-inspect and continue only when every touched field remains equal to the
   run's applied value.
4. Treat exact absence as already clean; reject replacement instances/resources and divergent
   fields.
5. Complete verification and write `report.json` after successful recovery.
6. Add no `package.json` command unless a separate entry materially improves usability; prefer one
   documented `ui:walkthrough` entry.

**Commit:** `feat(tooling): recover interrupted ui walkthroughs`

## Phase 5 — Documentation and guardrails

1. Update `CONTRIBUTING.md` with ordinary, plan, status, and recovery workflows.
2. Update `docs/agent-control/ui.md` only with durable developer-tool behavior; do not describe it
   as a public CLI transaction.
3. Extend automation-boundary tests to prohibit force recovery, arbitrary commands, selectors, and
   uncontained journal/output paths.
4. Keep `docs/user/cli.md` unchanged unless public Agent Control behavior changes.

**Commit:** `docs(tooling): document walkthrough recovery`

## Phase 6 — Verification

### Automated

- Manifest/plan and ownership unit tests;
- journal schema and atomic-write tests;
- scenario isolation tests;
- response-loss and fault-injection recovery tests;
- external unrelated revision versus touched-field divergence tests;
- exact surface/session/fixture identity tests;
- existing Agent Control, draft, fixture, and no-CDP boundary suites;
- `npm test`, frontend checks for script/documentation tests, then `npm run check`.

### Real Windows desktop

1. Start the development app and select its exact instance.
2. Run the standard product walkthrough and verify scenario-local cleanup.
3. Start a durable setup, terminate the runner after its journaled mutation, and run `--status`.
4. Run `--recover`; verify exact fields, surfaces, fixtures, and Transport sessions are restored.
5. Repeat with an unrelated durable change and confirm safe cleanup can rebase.
6. Repeat with a touched-field change and confirm recovery preserves the user's value.
7. Confirm two complete runs produce stable screenshot hashes and no residual blocking editor,
   surface, file session, or fixture.

Repeat on macOS when a desktop host is available.

## Final acceptance

- ordinary Manifest version 1 walkthroughs still work;
- every scenario restores and verifies before the next begins;
- the journal exists before the first mutation and survives interruption;
- `--status` is read-only and `--recover` targets only the recorded instance;
- owned and already-restored resources converge, divergent resources are preserved;
- no public CLI, generic transaction, force mode, selector, or direct store mutation is added;
- reports prove both artifacts and restoration;
- real Windows recovery and the full repository gate pass.

