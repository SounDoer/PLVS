# Agent Control Development Event Fixtures Design

**Date:** 2026-10-08  
**Status:** Proposed for review  
**Scope:** Development-identity visual-review orchestration for event-driven UI

## Summary

Add a closed, development-identity-only Agent Control fixture protocol that can establish a small
catalogue of deterministic application events in one selected PLVS workbench. The event must enter
through the same React owner and state transition as its real counterpart, mount the production
dialog, and then be inspected, captured, and safely dismissed through the existing public UI
Navigation and Visual Capture contracts.

The fixture protocol is not a new public Agent Control family. It is compiled only into the
`dev-identity` host and companion CLI, has no entry in `commandManifest.json`, is absent from
`app.capabilities`, public help, completion, offline schema, generated command documentation, and
installed Release/Preview binaries, and is rejected by a non-development host even if a caller
constructs its wire method manually.

The initial catalogue is:

| Fixture | Production surface | Initial variant | Ordinary safe recovery |
| --- | --- | --- | --- |
| `update.available` | `update` | available, idle | public `ui cancel` |
| `crash-report.pending` | `crashReport` | unsent saved report | public `ui close` (Later) |
| `close-confirmation.requested` | `closeConfirmation` | normal decision | public `ui cancel` |
| `library-conflict.pending` | `libraryConflict` | Theme conflict | private exact `fixture reset` only |

Update failure/busy phases, crash send failures, persistence-close failure, conflict resolution
failure, nested discard/reset decisions, native dialogs, permissions, hotplug, and fatal-render
fallback remain later catalogue candidates. They should be added only when their owning state
machine offers a deterministic, non-destructive setup and cleanup boundary.

## Product boundary

### What the fixture is

A fixture is a development-only source of one bounded event. It supplies deterministic input to an
existing owner, records that the resulting state came from a fixture, and can remove only that exact
fixture state. The owner, component, UI surface registration, blocking-editor registration, and
visible Close/Cancel behavior remain production code.

The normal visual-review sequence is:

1. select an exact development workbench;
2. call public `inspect` and `ui inspect` and retain `revision` and `uiGeneration`;
3. call the private fixture `establish` action with both tokens;
4. call public `ui inspect` and identify the real event surface;
5. call public `visual screenshot` with the returned revision and UI generation;
6. use public `ui close` or `ui cancel` when the visible surface supports it;
7. otherwise call private exact `fixture reset` for the fixture ID;
8. verify public `inspect` and `ui inspect` again.

### What it is not

- It is not `ui show`, a public capability, or a stable installed automation API.
- It cannot click, select DOM, type, press arbitrary keys, set arbitrary React state, or invoke an
  arbitrary component.
- It cannot call Save, Send, Confirm, Delete, Reload, Save as Copy, Update, Restart, Apply, Retry,
  Import, Export, or another result action.
- It cannot replace, close, or reset a real event or a user draft.
- It cannot edit persistence merely to make a prompt appear.
- It cannot expose crash payloads, release-note bodies, draft values, conflict documents, or fixture
  provenance through the public `ui inspect` projection.

## Current event inventory and real trigger chains

### Update Dialog

The coordinator-owned `useUpdateCheck` periodically calls `checkForUpdate()` and publishes
`updateInfo`. Settings shows the available update and its visible action calls
`AppSettingsOverlays.openUpdateDialog()`, which snapshots release notes and the updater handle.
`UpdateDialog` renders the decision while `useApplyUpdate` owns installation, progress, global
coordination, and restart phases. UI Navigation registers the mounted component as `kind: update`,
with Cancel only while the install state is not busy.

The fixture must enter at the overlay owner's existing open-update transition with a deterministic
update-info record. It must not construct an `UpdateDialog` beside the owner and must not provide a
working install handle. Because Confirm is not invoked by the fixture or public UI Navigation, a
non-installable sentinel handle is sufficient and is retained only in the owner. Public inspection
continues to reveal only `phase: idle`.

### Crash Report Dialog

`useCrashReporting` reads a pending report from the Rust crash-report store after boot and owns
`pendingReport`. `AppSettingsOverlays` mounts `CrashReportDialog`, which registers both
`useBlockingEditor("crash-report")` and the `crashReport` UI surface. Later closes only the prompt;
Send, Don't Send, and Don't Ask Again have separate destructive/network/persistence paths.

The fixture must call a development adapter on `useCrashReporting` that publishes the same
`pendingReport` state with a deterministic, in-memory report. It must never write a crash file.
Later follows the real `dismissPending` path and is the public safe cleanup. A hidden fixture token
allows reset to clear only the synthetic report if screenshot capture fails before Later.

### Close Confirmation

`useCloseConfirm` owns `dialogOpen`, pending close intent, persistence error, and closing state. A
native close request with no remembered close action sets the normal decision open. Tray Quit also
uses `requestCloseAction`, but that path may flush persistence and exit or hide the app.
`CloseConfirmDialog` registers the `closeConfirmation` surface and exposes public Cancel while it is
not busy.

The fixture must call an owner operation that performs only the decision-opening branch shared with
the native close-request handler. It must not call `requestCloseAction`, flush persistence, retire a
workspace, hide the window, or exit. Public `ui cancel` runs the real `handleCancel` behavior.

### Library Conflict

The multi-instance persistence backend reports a conflict after an expected-revision write fails,
or an editor explicitly calls `reportLibraryConflict`. `LibraryConflictDialog` subscribes through
`subscribeLibraryConflicts`; it has no Cancel or Close action because the user must choose Reload or
Save as Copy. Both visible actions mutate library state and remain unavailable to Agent Control.

The fixture must publish a tagged, deterministic conflict through the same backend notification
path so the real subscriber and dialog mount. It may not create the conflict by racing two real
workbenches or by writing a library. Since the production dialog deliberately has no safe public
dismissal, exact private reset is the only legal cleanup. Reset removes only a conflict carrying the
matching fixture token; it refuses a real conflict and does not resolve it as Reload or Copy.

### Other registered decisions

`ConfirmDialog`, `LibraryExportDialog`, and `ItemPickerDialog` already register nested surfaces and
have visible safe dismissal paths. They are not in the first event-fixture catalogue because their
owners need scenario-specific draft/transfer input and because several are already reachable from
public semantic families. Theme Preview and populated Presets are useful screenshots but are not
business events; they should receive separate, narrowly typed development fixtures later instead
of being mislabeled as event fixtures.

## Private protocol

The development CLI accepts a hidden root command which is deliberately absent from help and
completion:

```text
plvs-cli dev fixture establish <fixture-name> \
  --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli dev fixture reset <fixture-id> \
  --expected-revision <n> --expected-ui-generation <n> --json
```

The corresponding private wire methods are:

```text
dev.fixture.establish
dev.fixture.reset
```

There is no private `inspect` requirement in v1. Establish/reset responses provide the fixture ID,
name, changed flag, committed flag, revision, UI generation, and the mounted public surface ID when
settled. Public `ui inspect` remains the authoritative view of what the workbench actually mounted.

Strict parameters:

```json
{
  "name": "update.available",
  "expectedRevision": 12,
  "expectedUiGeneration": 4
}
```

```json
{
  "fixtureId": "fixture-opaque-token",
  "expectedRevision": 12,
  "expectedUiGeneration": 5
}
```

Fixture names are a closed enum. There are no payload, props, phase, text, component, selector,
state-path, or arbitrary action parameters. Deterministic payloads live in source control beside the
owner adapters.

## Build and exposure boundary

Three independent guards are required:

1. The Rust host recognizes private fixture CLI commands and wire methods only under
   `feature = "dev-identity"` (tests may compile the same code under `cfg(test)`).
2. The React bridge receives a non-public build flag from the Rust initialization snapshot and
   installs the fixture controller only when that flag is true. A manually forged request in other
   builds returns method-not-found before dispatch.
3. Contract tests prove fixture spelling is absent from `commandManifest.json`, public help,
   completion, `schema list/get`, generated Agent Control docs, and `app.capabilities`.

The build flag is not a public capability. Preview and Release identities do not receive it. The
public protocol normalizer stays manifest-backed; private fixture normalization lives in a separate
development module so a future manifest regeneration cannot publish it accidentally.

## React architecture

### Fixture controller

Add a development fixture controller beside UI Navigation, not inside it. It owns only:

- the active fixture identity and opaque lifetime token;
- the closed catalogue of owner adapters;
- serialized establish/reset actions;
- settlement against the existing UI surface registry.

Each adapter has typed `canEstablish`, `establish`, `matches`, and `reset` operations. It returns the
expected public surface kind and target phase. It never accepts component props from the wire.

The Agent Control bridge performs private normalization before the public normalizer only in a
development fixture build, validates both concurrency tokens, and invokes this controller. Public
dispatch and capabilities remain unchanged.

### Owner adapters

- `AppSettingsOverlays` registers the update fixture adapter around the same function used by the
  visible Install Update entry.
- `useCrashReporting` exposes an injected pending-report source tagged in a private ref; its public
  return shape carries only the existing pending report and dismissal behavior.
- `useCloseConfirm` exposes the decision-opening transition shared by the native close handler.
- the multi-instance backend exposes development-only publish/reset operations for tagged synthetic
  conflicts, while its ordinary subscribe/resolve contract remains unchanged.

Fixture provenance stays in refs/private backend metadata and is stripped before component props
or public UI inspection. Production components do not branch on fixture data.

## Conflicts, concurrency, and settlement

Every private fixture action requires the global revision and `uiGeneration` from the selected
workbench. Validation order is:

1. development identity and strict private request schema;
2. expected global revision;
3. expected UI generation;
4. exact active-fixture identity/idempotency;
5. no unrelated blocking editor;
6. no real or nested decision surface;
7. owner-specific availability, including coordinator-only update ownership;
8. establish the event once and wait for the expected production surface.

An exact repeated establish is idempotent and returns `changed: false`. A different fixture while
one is active fails. A real event that arrived first wins. If a real event races after validation,
the owner refuses replacement or the fixture action reports a committed/settlement failure and
preserves the visible state for inspection.

Fixture transitions never advance the global revision. Mount/unmount of the production surface
advances `uiGeneration` through the existing registry. A setup or reset settlement timeout reports
`committed`, the latest tokens, fixture ID, and expected surface kind; it does not automatically
roll back, because doing so could hide the evidence needed to diagnose the failure.

Reset requires the exact fixture ID and both current tokens. It refuses if the owner no longer
matches that fixture, if the event has become real, if user-authored content appeared in the
fixture-owned editor, or if the visible state has entered a result/busy phase. Reset is a recovery
operation, not a generic dismissal. A failed reset leaves the scene unchanged.

Multiple workbenches remain isolated by the existing `--instance` routing. Fixture IDs and owner
state are process-local and cannot be reused across instances.

## Stable private errors

Private errors are intended for repository tooling, not public compatibility:

- `fixtureUnavailable` — not a development identity or no owner adapter exists;
- `fixtureNotFound` — unknown fixture name or stale/wrong fixture ID;
- `fixtureConflict` — a different fixture, real event, nested decision, or blocking editor exists;
- `fixtureResetUnsafe` — the fixture is busy, changed into a result phase, or no longer matches its
  synthetic source;
- existing `revisionConflict`, `uiGenerationConflict`, and `uiNotSettled` keep their meanings.

Errors remain bounded and privacy-safe. They may include fixture name/ID, surface kind, and token
values, never event payloads or draft content.

## Screenshot walkthrough migration

Replace the cold-start `--plvs-ui-visual-fixture review-sequence` and its component-only sequence
with independent manifest scenarios. For each event scenario the runner establishes exactly one
fixture, calls public `ui inspect`, captures with public Visual Capture, dismisses through the
surface's public safe action when available, and finally calls exact private reset only if a
fixture remains.

The runner must preserve evidence on failure. It should write the report and screenshot artifacts,
record whether setup committed, and avoid broad best-effort cleanup after a token conflict. Only a
known active fixture with current tokens may be reset.

The legacy `UiVisualFixture` startup argument, component sequence, and `fixture` UI target are
removed after the new Windows desktop walkthrough proves equivalent screenshots. Ordinary product
walkthroughs and their public command contract remain unchanged.

## Recommended test seams

No test should assert private React setters or component implementation. The behavioral seams are:

1. **Private request boundary:** development CLI/private normalizer accepts only the closed command
   and field set; non-development builds and every public discovery surface expose nothing.
2. **Fixture controller boundary:** establish/reset obey tokens, conflicts, idempotency, exact
   fixture lifetime, failure preservation, and multi-workbench isolation.
3. **Owner boundary:** each fixture enters the same owner transition as the real event and mounts
   the production component; public Close/Cancel follows the existing visible callback.
4. **Public observation boundary:** after establishment, unmodified `ui inspect` and
   `visual screenshot` observe/capture the surface, while payload/provenance remains private.
5. **Walkthrough boundary:** the repository runner uses private establish plus public inspect,
   screenshot, and safe dismissal, and restores or preserves evidence predictably.

These seams require explicit approval before the first red test, per the repository's TDD workflow.

## Decisions

1. Keep public UI Navigation unchanged; fixtures are not `ui show` targets.
2. Gate the complete path by `dev-identity`, not merely `debug_assertions`, so packaged development
   builds can run the same walkthrough while Preview/Release cannot.
3. Use a hidden development CLI command as the transport client; do not add a second unauthenticated
   socket or edit runtime stores from the walkthrough script.
4. Make fixtures independent rather than a startup sequence, so failures do not force later scenes
   to inherit an unknown step.
5. Prefer public Close/Cancel for cleanup. Use exact private reset only for recovery and for Library
   Conflict, whose production contract intentionally has no non-result dismissal.
6. Keep deterministic fixture input in code and closed enums; accept no arbitrary payloads.
7. Preserve the scene after setup/reset failure and require inspection instead of blind retry.
