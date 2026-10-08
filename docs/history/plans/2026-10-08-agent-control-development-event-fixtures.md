# Agent Control Development Event Fixtures — Implementation Plan

> Proposed implementation plan. Confirm the test seams in the linked design before adding the
> first failing test.

**Goal:** Let development screenshot walkthroughs independently establish deterministic event-driven
PLVS dialogs through Agent Control without publishing fake events or generic UI automation.

**Architecture:** A `dev-identity`-only private CLI and wire normalizer call a React fixture
controller. Closed owner adapters inject deterministic inputs into the existing update, crash,
close-confirmation, and Library Conflict state machines. Public UI Navigation and Visual Capture
remain the only observation, screenshot, and ordinary safe-dismiss APIs.

**Spec:**
`docs/history/specs/2026-10-08-agent-control-development-event-fixtures-design.md`

## Delivery rules

- Work on `main`; do not create a worktree without user approval.
- Run one red/green vertical slice at a time after the five behavioral seams in the spec are
  confirmed. Do not prebuild all tests against an imagined controller.
- Before every commit, run `npm test` and the checks for every touched side. Before final delivery,
  run `npm run check` and the real Windows desktop walkthrough.
- Never edit `docs/agent-control/generated/` by hand. The private protocol must not require their
  regeneration because it is absent from the public manifest.
- Do not add a public capability, command-manifest entry, public documentation syntax, generic
  click/selector/input path, arbitrary fixture payload, or result action.
- On a setup/reset failure, preserve the live scene and report exact tokens/fixture ID; do not hide
  the evidence with unconditional cleanup.

## Phase 1 — Private protocol and exposure guards

### Slice 1: Prove the public surface cannot expose fixtures

**Tests first:**

- add a contract test that scans the command manifest, capabilities result, public help/completion,
  offline schema catalogue, and generated Agent Control docs for private fixture method/command
  names;
- compile/run the equivalent Rust assertion without `dev-identity` and prove a forged private
  method is rejected.

**Implementation:**

- add `src/agentControl/developmentFixtureProtocol.js` with strict closed request normalization;
- add a Rust `dev-identity`-gated hidden parser branch for `dev fixture establish/reset`;
- map the hidden command to `dev.fixture.establish/reset` without adding manifest entries;
- inject a private `developmentFixtures` build flag into the boot snapshot only for
  `dev-identity`; do not publish it through capabilities;
- keep the public normalizer and generated schema unchanged.

**Focused checks:** protocol tests, public-surface docs tests, CLI parser/contract tests, Rust
initial-state tests.

### Slice 2: Define the fixture controller lifetime

**Tests first:** controller-level behavior through its exported establish/reset operations:

- requires both current tokens;
- creates one opaque fixture lifetime;
- exact repeat is a no-op;
- different fixture, blocking editor, real event, or nested decision is refused before owner call;
- reset requires the exact ID and current tokens;
- settlement failure reports committed state and keeps the fixture active.

**Implementation:**

- create `src/dev/DevelopmentEventFixturesContext.jsx`, loaded only when the boot flag is true;
- keep a closed adapter registry and serialized action lane;
- use the existing UI Navigation inspection/settlement boundary, without adding a fixture origin or
  fields to public inspection;
- route private requests in the bridge before public protocol normalization only when enabled;
- return bounded private results/errors and never advance the durable revision.

**Focused checks:** new context tests, UI Navigation tests, bridge tests.

Commit after Phases 1 slices pass:

```text
feat(agent-control): add private development fixture protocol
```

## Phase 2 — Owner-backed event fixtures

### Slice 3: Close Confirmation tracer

This is the smallest owner transition and proves the complete path.

**Red:** a development establish request opens the real `CloseConfirmDialog`; public `ui inspect`
sees `closeConfirmation`; public `ui cancel` closes it; Confirm/Retry/persistence/exit callbacks are
never called.

**Green:** refactor `useCloseConfirm` to share one `openDecision` transition between the native
close handler and a development adapter. Register that adapter from `AppLifecycleContext`.

**Desktop proof:** establish, inspect, screenshot, cancel, inspect clean.

### Slice 4: Pending Crash Report

**Red:** establish publishes a deterministic in-memory report through `useCrashReporting`, mounts
the real blocking `CrashReportDialog`, refuses scene replacement, and public Close calls Later only.
No crash file, send, discard, or setting change occurs.

**Green:** add a tagged fixture source/ref to the hook, a deterministic report factory, exact reset,
and an AppLifecycle adapter. Keep the component props and public inspection projection unchanged.

**Desktop proof:** establish, verify blocking editor, screenshot, close, verify clean.

### Slice 5: Available Update

**Red:** coordinator development instance establishes the deterministic available-update record,
the real overlay owner opens the production `UpdateDialog`, and public Cancel closes it without
install/restart/global coordination. A participant workbench refuses the fixture.

**Green:** extract the existing overlay transition to accept one owner-supplied update record;
register a closed fixture adapter with a non-installable sentinel handle and deterministic release
notes. Reset uses the same cancel transition while idle only.

**Desktop proof:** establish, screenshot, cancel; verify the update check's real state remains
unchanged.

### Slice 6: Library Conflict

**Red:** establish publishes a tagged Theme conflict through the real persistence subscription;
the production dialog mounts with no public actions; public `ui close/cancel` remains unavailable;
exact private reset clears it without calling Reload/Save as Copy. Reset refuses real conflicts and
wrong IDs.

**Green:** extend the backend with development-only tagged publish/reset methods, exported only to
the fixture controller. Do not change ordinary `reportLibraryConflict`, subscribe, or resolve
semantics and do not place a synthetic document in durable storage.

**Desktop proof:** establish, inspect, screenshot, reset, inspect clean.

For every owner slice, add component/owner integration tests at the public UI and business-operation
seams. Do not mock private setters or render a duplicate fixture-only dialog.

Commit after the owner slices pass:

```text
feat(ui): drive event fixtures through real owners
```

## Phase 3 — Walkthrough migration

### Slice 7: Declarative independent fixture scenarios

**Tests first:** update manifest validation and runner tests so each fixture scenario names one
closed fixture, establishes it privately, discovers the resulting surface through public
`ui inspect`, screenshots with both tokens, and uses the declared public safe action or exact reset.

**Implementation:**

- replace `fixture.uiSequence` and `ui.kind: fixture` with `ui.kind: eventFixture` and one of the
  closed fixture names;
- teach the runner to invoke hidden `dev fixture establish/reset` only from the development CLI;
- do not look for private methods in `app.capabilities`;
- record fixture ID, setup/reset commit state, public surface ID, and artifact identity in
  `report.json` without recording fixture payloads;
- preserve report/artifacts and stop on token conflict or unsafe reset.

### Slice 8: Remove the startup component sequence

- replace the checked development fixture manifest with independent close/update/crash/conflict
  scenarios;
- keep Theme Preview and populated Presets out of the event catalogue; either retain a separately
  named closed visual fixture temporarily or move them in a later typed visual-fixture change;
- after pixel-equivalent Windows captures exist, remove `src/dev/UiVisualFixture.jsx`,
  `--plvs-ui-visual-fixture`, its boot-snapshot field, the sequential runner assumptions, and the
  cold-start instructions;
- update `CONTRIBUTING.md` and `docs/agent-control/ui.md` to describe the repository-only workflow
  without documenting private CLI syntax as a supported product contract.

Commit after the migration passes:

```text
refactor(tooling): orchestrate event fixtures through agent control
```

## Phase 4 — Contract, desktop, and full-gate verification

### Automated verification

- focused Vitest suites for each red/green slice;
- `npm test`, `npm run format:check`, `npm run lint`, and `npm run typecheck` before frontend/tooling
  commits;
- Rust CLI/host tests and `npm run rust:check` before Rust commits;
- tests proving Release and Preview identities cannot parse or dispatch private fixtures;
- tests proving public help, completion, capabilities, manifest, schemas, and generated docs remain
  byte-for-byte fixture-free;
- `npm run check` after all slices.

### Real Windows desktop verification

Run a development-identity app and:

1. identify the exact workbench with `instances`;
2. for each initial fixture, retain public revision/UI generation, establish privately, inspect the
   mounted production surface, capture `main`, and dismiss/reset exactly;
3. repeat an exact establish and verify no-op tokens;
4. attempt a different fixture while one is open and verify the first remains;
5. open a Theme editor draft, attempt establish, and verify the draft and preview remain unchanged;
6. create a real event where practical, attempt fixture establish/reset, and verify the real event
   wins;
7. run two workbenches and prove the fixture appears only in the selected instance;
8. run the development fixture walkthrough twice and compare successful restoration reports and
   expected screenshot dimensions/hashes;
9. run `npm run smoke:agent-control` and `npm run check`.

No capture/DSP/audio directories should change, so capture smoke/soak is not required.

## Approved test seams required before implementation

Implementation begins only after the user confirms these five seams from the design:

1. private request/exposure boundary;
2. fixture controller state-machine boundary;
3. owner/business-entry boundary;
4. unchanged public UI inspect/screenshot boundary;
5. walkthrough orchestration/restoration boundary.

## Final acceptance

- private fixture code is unreachable in Release/Preview identities and invisible to every public
  discovery/documentation surface;
- every established scene is a production component mounted by its real owner/state machine;
- no fixture or public command executes a result action;
- exact public Close/Cancel is preferred; Library Conflict uses only exact private reset;
- blocking editors, real events, multiple workbenches, and stale tokens are refused without losing
  user state;
- repeated establish/reset behavior is deterministic and failure preserves evidence;
- the event walkthrough uses no Playwright/CDP, selectors, clicks, arbitrary input, or arbitrary
  React state mutation;
- real Windows screenshots and `npm run check` pass.
