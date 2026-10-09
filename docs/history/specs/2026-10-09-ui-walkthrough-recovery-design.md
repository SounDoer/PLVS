# UI Walkthrough Recovery Design

**Date:** 2026-10-09

**Status:** Accepted for implementation

**Scope:** Repository-owned Agent Control walkthrough planning, scenario isolation, durable recovery
journals, and interrupted-run recovery

## Summary

Evolve the existing `ui:walkthrough` developer tool into a recoverable scenario runner. The runner
will continue to compose the public Agent Control families, semantic UI Navigation, Editor Draft
Control, and development-only event fixtures. It will not add a public transaction command or an
application-level rollback mechanism.

The runner will write a private recovery journal before its first mutation, restore each scenario's
durable fields immediately after that scenario, retain suite-owned fixtures only for the suite
lifetime, and support `--status` and `--recover` for an interrupted run. Recovery operates only on
resources whose ownership can be proven from exact field values or opaque IDs. There is no force
mode.

## Goals

1. Prevent one screenshot scenario's durable setup from leaking into the next scenario.
2. Retain enough evidence to recover after the Node process exits between mutation and cleanup.
3. Restore only fields and exact resources still owned by the run.
4. Distinguish an already-restored resource from a safe restore and an external divergence.
5. Keep all product mutations on existing Agent Control business paths with revision checks.
6. Produce a report that proves both artifact capture and final restoration.
7. Keep Manifest version 1 and current invocation compatible.

## Non-goals

- A public `plvs-cli transaction`, snapshot, rollback, or force-restore family.
- Rolling back the whole application or overwriting unrelated user changes.
- Persisting recovery state inside PLVS.
- Generic commands, selectors, clicks, keystrokes, React state access, or arbitrary JSON paths.
- Recovering across a replacement workbench instance after PLVS restarts. An instance mismatch is
  preserved for human reconciliation.
- Automatically confirming decisions other than the exact Editor Draft discard already supported.
- Turning screenshots into a release-time product feature.

## Current implementation and gaps

`scripts/ui-visual-walkthrough.mjs` already validates a closed Manifest, targets one explicit
workbench, records initial family snapshots, opens semantic surfaces, patches and discards editor
drafts, establishes development event fixtures, analyzes deterministic audio, captures screenshots,
and restores selected Settings/View/Transport state.

The current recovery information is primarily in memory. Durable patches accumulate until the end
of the suite, cleanup behavior is interleaved with capture behavior, and a killed runner has no
supported recovery entry point. The restoration ledger records original values but not the value
the run applied, so it cannot prove field ownership after an interruption.

## Product boundary

This is repository tooling for developers, CI, and agents. Its public entry remains:

```text
npm run ui:walkthrough -- --manifest <file> --out-dir <directory>
```

The same entry gains developer-tool modes:

```text
npm run ui:walkthrough -- --manifest <file> --out-dir <directory> --plan
npm run ui:walkthrough -- --status <run.json>
npm run ui:walkthrough -- --recover <run.json>
```

No mode appears in public `plvs-cli` help, capabilities, completion, schema, or generated command
documentation. The runner may motivate a future atomic Agent Control command only when a required
product operation does not already exist; that command requires a separate design.

## Run journal

The output directory contains:

```text
run.json
events.jsonl
report.json
<scenario screenshots>
```

`run.json` is a bounded, private, atomically replaced document. It contains:

- schema version, run ID, phase, timestamps, Manifest hash, and Manifest path;
- exact workbench instance ID and application/protocol identity observed at start;
- initial revision and UI generation;
- suite resources and one record per scenario;
- field resources with `before`, `applied`, and restoration status;
- opaque resources created or opened by the run, such as session, surface, editor, decision, and
  fixture IDs;
- the last stable error and whether recovery is safe, already complete, divergent, or blocked.

The journal contains only Manifest-approved public fields and opaque IDs. It does not record
feedback text, crash payloads, diagnostics, arbitrary application snapshots, or authentication
material.

Every side effect uses a write-ahead transition:

1. persist `intent` and the expected tokens;
2. invoke one Agent Control operation;
3. inspect the owner when a response is absent or ambiguous;
4. persist the observed result and ownership evidence.

Journal updates use a same-directory temporary file, restrictive permissions where supported, and
rename replacement. `events.jsonl` is append-only diagnostic evidence; `run.json` is authoritative.

## State model

Run phases are:

```text
planned -> preparing -> running -> cleaning -> verifying -> complete
```

Terminal attention states are:

```text
needsRecovery
preserved
recoveryFailed
```

Scenario phases use the same prepare/run/clean/verify sequence. A scenario is verified before the
next scenario starts. Suite fixtures are prepared before the first scenario and cleaned only after
all scenario scopes have completed.

Invalid phase transitions fail locally before Agent Control is invoked.

## Resource ownership

### Durable fields

Each touched field records:

```text
resource key
before value
applied value
latest observed value
status
```

Recovery classifies the current value independently:

- equal to `before`: already restored;
- equal to `applied`: still owned and safe to restore;
- anything else: externally diverged and must be preserved.

Restoration patches only owned fields. A global revision conflict triggers inspection. If the
touched fields still equal their applied values, cleanup may rebase onto the current revision and
restore only those fields. If any touched field diverged, cleanup stops without overwriting it.

Setup and capture operations never retry blindly after a revision or UI-generation conflict.

### Exact resources

Created resources are owned only by exact opaque identity:

- Transport cleanup removes only the recorded file session ID;
- UI cleanup addresses only the recorded surface ID;
- event fixture cleanup uses only the recorded fixture ID;
- draft discard requires the recorded editor surface and its linked decision surface.

Absence of an exact run-owned resource is treated as already cleaned when the owner's durable state
also satisfies the baseline. A same-kind replacement resource is never adopted.

### Uncertain editor state

A dirty editor whose patch or discard settlement is uncertain is preserved. Recovery may inspect
the exact surface and report current generations, but it does not invent a replacement confirmation
or discard a draft whose recorded generation no longer matches.

## Scenario isolation

Each scenario has its own durable ledger built from a fresh pre-scenario inspection. The sequence
is:

```text
inspect -> journal -> prepare -> open -> capture -> dismiss -> restore -> verify
```

The next scenario cannot start until the prior scenario is verified. This changes current suite-end
durable restoration into scenario-end restoration. A deterministic audio fixture remains suite
scoped because the Manifest already declares it at the suite root.

Repeated touches inside one scenario restore the first `before` value. Separate scenarios each get
their own baseline. Cross-scenario state dependencies remain unsupported; they belong inside one
explicit scenario or a future explicitly declared suite fixture.

## Recovery modes

### `--plan`

Validates the Manifest, resolves required methods and touches, inspects capabilities and the target
workbench, and prints the closed plan without mutation. It does not create `run.json`.

### `--status`

Reads and validates one contained journal, reports its phase and outstanding resources, and does
not connect to or mutate PLVS.

### `--recover`

Validates the journal schema and hash, connects only to the recorded workbench instance, inspects
current public state, and reconciles resources in reverse ownership order. It refuses a missing or
replacement instance, malformed journal, changed identity, unknown resource kind, or external
divergence. Successful recovery continues verification and writes the final report.

There is no `--force`. A local `--preserve-on-failure` option may suppress otherwise safe automatic
cleanup for debugging, but it cannot override identity, generation, or ownership checks.

## Failure policy

| Condition | Behavior |
| --- | --- |
| Capture fails while all resources are exactly owned | Attempt normal cleanup, retain capture failure |
| Exact surface/session is already absent | Reconcile as already cleaned, then verify |
| Only unrelated global revision changed | Re-inspect and restore exact owned fields |
| A touched field differs from both before and applied | Preserve and report divergence |
| Draft generation or linked decision changed | Preserve the editor and report exact IDs |
| Fixture reset fails | Record fixture ID and `needsRecovery` |
| Target instance disappears | Persist `needsRecovery`; do not select another instance |
| Settlement may have committed | Inspect exact owner; preserve if ownership is uncertain |

## Internal architecture

The existing entry point becomes a thin CLI adapter over modules under `scripts/ui-walkthrough/`:

```text
planner.mjs       Manifest validation and closed execution plan
journal.mjs       Schema, atomic persistence, and phase transitions
runner.mjs        Suite/scenario orchestration
recovery.mjs      Ownership reconciliation and interrupted-run recovery
resources/*.mjs  Durable field, UI, draft, fixture, and Transport adapters
```

Resource adapters expose a small internal contract:

```text
prepare
record
reconcile
restore
verify
```

They compose existing CLI calls and never receive arbitrary command strings from a Manifest.

## Reports

`report.json` records:

- plan and Manifest identity;
- per-scenario artifact path and SHA-256;
- before/applied/final evidence for each touched field;
- exact opaque resources created and cleaned;
- automatic recovery attempts and their classifications;
- final revision/UI generation and verification status;
- actionable outstanding IDs without private authored content.

A successful exit requires both scenario success and restoration verification. A captured image is
not reported as a successful walkthrough when final state is unverified.

## Testing boundary

Tests use these behavioral seams:

1. Manifest-to-plan projection contains only closed semantic operations.
2. Journal transitions are atomic, schema checked, and crash resumable.
3. Ownership classification independently distinguishes owned, restored, and diverged fields.
4. Scenario cleanup completes before the next scenario setup.
5. Recovery never adopts a replacement resource or force-overwrites a changed field.
6. Fault injection after every write-ahead boundary converges to complete or preserved.
7. A real Windows development app survives runner termination and exact recovery without durable
   drift; macOS repeats the workflow when a host is available.

## Decisions

1. Keep transactions in repository tooling, not the public CLI or PLVS runtime.
2. Preserve Manifest version 1 while changing execution to scenario-scoped restoration.
3. Persist a write-ahead journal before the first mutation.
4. Restore by proven field value or opaque identity, never by UI kind or current top surface.
5. Permit cleanup to rebase over unrelated revision changes only after field ownership inspection.
6. Preserve uncertain drafts and externally diverged fields; provide no force mode.
7. Treat suite audio as a suite resource and every scenario's durable patch as scenario-local.
8. Require restoration verification for a successful walkthrough result.

