# PLVS CLI v1

Date: 2026-09-05
Status: Approved product direction; implementation pending

## Purpose

PLVS CLI v1 turns the command line from a collection of standalone utilities into a stable control
surface for the running desktop product. It is intended for users, agents, and user-authored
automation. A command belongs in the public CLI only when it controls or inspects a real PLVS user
workflow.

The one exception is `doctor`: diagnosis must remain available when PLVS cannot start or Agent
Control cannot be reached.

This design establishes the public boundary and the compatibility rules before Theme, Loudness
Profile, Device, and other controls expand the surface.

Agent Control has not been publicly released. This work is therefore a pre-release contract
finalization rather than a user-facing migration: old App Control JSON shapes, flags, and command
names are replaced directly, with no aliases, deprecation warnings, compatibility period, or
external-script migration work. Compatibility begins when CLI v1 ships.

## Product boundary

The public command tree has two roots:

```text
plvs-cli doctor
plvs-cli app ...
```

Every `app` command requires all of the following:

1. PLVS is running.
2. Agent Control is enabled in Settings.
3. The frontend control bridge is ready.

The CLI never starts PLVS implicitly. It never edits the installed configuration store behind the
running app. It does not provide a headless version of a desktop feature. The running app owns
validation, state transitions, native integrations, persistence, blocking-editor safeguards, and
the resulting revision.

This gives an agent one dependable model: if a user asks it to do something in PLVS, it controls the
same visible application and state the user is looking at.

## Public commands removed

The following early standalone commands are removed from the installed CLI:

| Command                          | Reason                                                                                           | Destination, if any                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `probe`                          | Headless media inspection is outside the PLVS desktop workflow.                                  | Existing app file flow exposes relevant media state.        |
| `analyze`                        | Analyzing a file while PLVS is closed is not a core user workflow.                               | `app file ...` controls the app's file sessions.            |
| `analyze-batch`                  | Batch headless analysis inherits the same product mismatch.                                      | No public replacement until PLVS has a real batch workflow. |
| `report`                         | It exists only to format output from the removed headless commands.                              | Agents summarize structured app inspection directly.        |
| `capture`                        | Its demonstrated consumers are release smoke and soak infrastructure.                            | Repository-owned capture harness.                           |
| `devices`                        | Its current public purpose is selecting a device for headless capture.                           | `app device list` when Device Control is added.             |
| `profile validate/export/import` | It edits the installed store while the app is closed and uses `profile` for whole configuration. | Live `app config ...` when Configuration Control is added.  |

These commands are deleted without aliases or a deprecation period. PLVS has not yet declared a
stable CLI contract, and retaining them would preserve the product boundary this cleanup is meant
to remove. The parser reports them as unknown commands after migration.

The implementation modules may remain temporarily when internal release tooling still uses their
pure logic. They are not reachable from the installed public parser, root help, user documentation,
or discovery metadata.

## What remains outside Agent Control

`doctor` is the only operational exception. It checks enough of the installed runtime to explain
why PLVS or Agent Control is unavailable, including installation layout and required sidecars. It
may inspect the host and enumerate devices as diagnostic checks, but it does not mutate settings,
open capture sessions, analyze user media, or become a second product API.

The following packaging features also remain:

- the `plvs-cli` executable beside the desktop binary;
- Windows PATH integration;
- the Windows registry discovery record and platform equivalents;
- `--help` and `--version`;
- the authenticated discovery mechanism used by `app` commands.

These are access and discovery infrastructure rather than additional product command families.

## Command naming

Public names describe product concepts rather than implementation layers. The intended families are:

```text
plvs-cli app inspect
plvs-cli app capabilities
plvs-cli app wait ...
plvs-cli app workspace ...
plvs-cli app panel ...
plvs-cli app axis ...
plvs-cli app preset ...
plvs-cli app settings ...
plvs-cli app transport ...
plvs-cli app dock ...

# Future families, added only with their user-facing product feature
plvs-cli app device ...
plvs-cli app config ...
plvs-cli app theme ...
plvs-cli app loudness-profile ...
plvs-cli app operation ...
```

Terminology is reserved as follows:

- **Configuration** means a whole-application backup or migration document (`.plvsconfig`).
- **Preset** means a saved working scene.
- **Theme** means one visual theme in the user's theme library.
- **Loudness Profile** means one loudness reference and rule set.
- `profile` is not reused as shorthand for whole configuration.

The CLI should follow the product UI's nouns. A feature is not added to the CLI until the product
has a coherent user operation to expose.

## Human and machine output

Commands default to concise human-readable output. Its wording, colour, spacing, and table layout
may improve without a compatibility promise.

`--json` selects the stable machine contract. In JSON mode:

- stdout contains exactly one UTF-8 JSON document followed by a newline;
- stdout contains no banners, progress text, ANSI escapes, or npm wrapper output;
- stderr may contain non-machine diagnostic context, but never a second JSON result;
- every execution that reaches the CLI parser emits the common success or error envelope;
- secrets, authentication tokens, stack traces, and internal filesystem paths are not exposed;
- `--out <path>` retains tee semantics and writes the exact stdout bytes to the file.

The installed binary is the protocol endpoint. Repository wrappers must preserve clean stdout when
used programmatically.

## JSON envelope

All successful JSON output uses:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {}
}
```

All failed JSON output uses:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "agentControlDisabled",
    "message": "Agent Control is disabled."
  }
}
```

Rules:

- `schemaVersion`, `ok`, and exactly one of `result` or `error` are required.
- `error.code` is a stable machine identifier in lower camel case.
- `error.message` is user-facing English text and may be improved or localized.
- `error.details` is optional structured context. Consumers must not parse `message` for data.
- JSON field names use lower camel case.
- Unknown fields must be ignored by consumers.
- A value that is conceptually present but unavailable is `null`; an optional concept that does not
  apply is omitted. Each command contract states which case it uses.
- Timestamps, when present, are UTC RFC 3339 strings.
- Identifiers are opaque strings. Consumers must not infer type or chronology from their spelling.

`doctor --json` migrates into this envelope. Its existing diagnostic report becomes
`result.report`; its check statuses remain domain data and do not replace top-level `ok`.

Example:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "report": {
      "status": "warning",
      "summary": {
        "ok": 8,
        "warning": 1,
        "error": 0,
        "skipped": 0
      },
      "checks": []
    }
  }
}
```

A completed doctor report with warnings is still a successfully executed command. A report with a
required check in `error` state uses process exit code `1`, while keeping the successful envelope so
support tooling receives the full report. This is the one documented case where `ok: true` may pair
with a nonzero exit code: the command ran successfully, but the diagnosed installation is unhealthy.

## Schema version and compatibility

`schemaVersion` is one global integer for the public CLI JSON contract. It is independent of the
PLVS and CLI release versions.

The following are compatible v1 changes:

- adding a command;
- adding an optional field;
- adding a new error code for a new failure;
- improving `error.message`;
- changing human-readable output.

The following require a new schema version:

- removing or renaming an existing field;
- changing a field's type or established meaning;
- changing required presence into optional presence;
- changing the common envelope;
- changing the meaning of an existing error code or enum value.

Adding an enum value to an explicitly open-ended field is compatible. Closed enums must say so in
their command contract; adding a value to a closed enum is breaking. Contract tests and generated
reference fixtures pin every stable envelope and command result.

Schema v1 becomes binding only after this cleanup lands. Existing standalone report shapes and the
current App Control envelope are migration inputs, not compatibility obligations.

## Exit codes

Exit codes classify the outcome coarsely. JSON error codes carry the precise reason.

| Code | Class                               | Examples                                                                                                           |
| ---: | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
|  `0` | Success                             | Query completed; mutation reached its requested state; healthy or warning-only doctor report.                      |
|  `1` | Runtime or system failure           | Device failed to start, file could not be written, internal operation failed, doctor found a required check error. |
|  `2` | App unavailable for control         | App not running, Agent Control disabled, frontend not ready, protocol incompatible.                                |
|  `3` | Invalid command input               | Missing argument, invalid enum or path syntax, unknown command, required revision omitted.                         |
|  `4` | Current state refuses the operation | Revision conflict, blocking editor open, wait concurrency limit reached.                                           |
|  `5` | Wait did not complete               | Timeout or cancellation.                                                                                           |

Every failed command has both a nonzero exit code and, under `--json`, the error envelope. Human
mode uses the same exit code. An unknown internal failure maps to exit `1` and `internalError`.

Stable initial error codes include:

| Exit | Error code             | Meaning                                                         |
| ---: | ---------------------- | --------------------------------------------------------------- |
|  `1` | `runtimeError`         | A known runtime integration failed.                             |
|  `1` | `internalError`        | An unexpected implementation failure occurred.                  |
|  `1` | `outputWriteFailed`    | A requested output could not be written.                        |
|  `2` | `appNotRunning`        | No matching PLVS runtime is available.                          |
|  `2` | `agentControlDisabled` | The user has disabled Agent Control.                            |
|  `2` | `frontendNotReady`     | PLVS is starting or its control bridge is unavailable.          |
|  `2` | `protocolMismatch`     | App and CLI cannot negotiate a supported control protocol.      |
|  `3` | `invalidArguments`     | Command syntax or a value is invalid.                           |
|  `3` | `unknownCommand`       | The command or subcommand does not exist.                       |
|  `3` | `revisionRequired`     | A mutation omitted `--expected-revision`.                       |
|  `3` | `resourceNotFound`     | A user-supplied opaque ID does not identify a current resource. |
|  `4` | `revisionConflict`     | State changed since the caller inspected it.                    |
|  `4` | `editorActive`         | A blocking editor protects an open draft.                       |
|  `4` | `operationNotAllowed`  | Valid input cannot be applied in the current product state.     |
|  `4` | `waitLimitReached`     | The app's bounded wait capacity is full.                        |
|  `5` | `timeout`              | A wait condition did not become true in time.                   |
|  `5` | `cancelled`            | The requested wait or operation was cancelled.                  |

Feature-specific codes may be more precise. They must map to one of the stable exit classes and must
not reuse an existing code with a different meaning.

## Query results

Every `app` query returns the current global `revision` alongside its domain result:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "revision": 44,
    "workspace": {}
  }
}
```

Queries do not accept `--expected-revision` and never change revision. `app inspect` is the broad snapshot
used to begin a control transaction. Narrow queries return only their domain and the same global
revision.

Meter frames and other continuously changing measurements are data, not control state. They do not
increment revision. A future meter sampling API must provide its own sample time or sequence.

## State mutations

A state mutation declares a desired final state. Examples include changing a panel control,
applying a workspace, selecting a theme, or entering Dock mode.

Every state mutation:

- requires `--expected-revision <n>`;
- supports `--dry-run`;
- compares the revision atomically with applying the mutation;
- returns `changed`, the resulting global `revision`, and the relevant final `state`;
- succeeds with `changed: false` when the requested state already holds;
- increments revision exactly once when user-observable control state changes;
- leaves revision unchanged for a no-op or dry-run.

Example:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "changed": true,
    "revision": 45,
    "state": {
      "panelId": "spectrum-1",
      "controls": {
        "speed": "fast"
      }
    }
  }
}
```

The final `state` contains the portion directly affected by the command, not a complete application
snapshot. This lets the caller verify the result without issuing a second query.

`--expected-revision` replaces domain-specific CLI names such as
`--expected-workspace-revision` and `--expected-settings-revision`. It reads as a complete
precondition: execute only when the app is still at the revision the caller inspected. The wire
protocol may retain domain revisions internally during implementation, but the public v1 CLI has
one concurrency token.

The CLI never retries a `revisionConflict`. An agent must inspect the new state, reconcile the
user's intervening change, and issue a new explicit mutation.

## Dry-run

`--dry-run` answers: "Would this state mutation be accepted at this revision, and what final state
would it produce?"

It performs the same argument, revision, resource, blocking-editor, and business-rule validation as
the real mutation. It computes the same normalized final state but performs no observable side
effect: no memory or persisted state change, native call, window movement, device switch, file
write, dialog, reanalysis, or revision increment.

Its result adds `dryRun: true`:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "dryRun": true,
    "changed": true,
    "revision": 44,
    "state": {}
  }
}
```

If the real mutation would be refused by a pure precondition, dry-run returns the same error code
and exit class. Dry-run does not claim that an external system call would succeed later.

## Actions

An action asks PLVS to perform a process whose outcome cannot be fully predicted from state alone,
such as starting a device, opening and analyzing media, restarting the app, or exporting a file.

Every action:

- requires `--expected-revision <n>` because it can race with visible user activity;
- does not support `--dry-run` unless the feature defines a truthful, side-effect-free preview;
- returns a stable `action` identifier, `status`, and the latest revision;
- includes `state` when it changed app state;
- includes `output` when it produced an external artifact.

Synchronous completion uses:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "action": "config.export",
    "status": "completed",
    "revision": 45,
    "output": {
      "path": "C:\\Users\\me\\Desktop\\studio.plvsconfig"
    }
  }
}
```

`status` for an action response is the closed enum `completed | accepted`. Cancellation is a failed
outcome with error code `cancelled`, not a successful action status.

## Long-running operations

Commands wait for completion by default. A feature that is meaningfully long-running and
cancellable may support `--no-wait`. In that case it returns `accepted` and an opaque
`operationId`:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "action": "file.open",
    "status": "accepted",
    "operationId": "op_123",
    "revision": 46
  }
}
```

The public operation family is added only when the first product action needs it:

```text
plvs-cli app operation get <operation-id> --json
plvs-cli app operation wait <operation-id> [--timeout <duration>] --json
plvs-cli app operation cancel <operation-id> --expected-revision <n> --json
```

Operation states are the closed enum:

```text
pending | running | completed | failed | cancelled
```

`progress` is optional and appears only when the app has a real progress measure. It uses a number
from `0` through `1`; an indeterminate operation omits it.

`operation get` and `operation wait` return `ok: true` when the lookup/wait command succeeds, even
if the operation they found ended in `failed`. The nested operation carries its own structured
`error`. A synchronous action that waits and then fails returns the normal top-level error envelope,
with `operationId` in `error.details` when one exists.

Revision follows visible state rather than operation lifetime:

- accepted responses report the revision after acceptance;
- get/wait responses report the revision at observation time;
- a terminal operation records `completedRevision`;
- cancellation is a mutation and requires `--expected-revision`;
- progress updates alone do not increment revision unless progress is part of the public controlled
  state exposed by inspect.

## Waiting for application state

Waiting for an operation and waiting for application state are separate APIs.

`app wait` waits for a public state condition. The CLI does not expose a general expression
language. Version 1 supports typed forms whose paths and value types come from capabilities, plus a
dedicated revision form:

```powershell
plvs-cli app wait --after-revision 44 --timeout 30s --json
plvs-cli app wait --path live.running --equals true --timeout 10s --json
```

This is a query, so it does not accept `--expected-revision`. If the condition is already true it succeeds
immediately with `matchedImmediately: true`. Otherwise it returns the matching value, relevant
state, and latest revision when the condition becomes true.

A timeout returns `timeout` and exit `5`, with the condition, latest revision, and last observed
value in `error.details`. The app bounds concurrent waits and returns `waitLimitReached` with exit
`4` when capacity is exhausted.

The existing specialized wait flags remain migration inputs. The v1 implementation should prefer
typed flags for common conditions over accepting arbitrary user-authored field paths. If generic
`--path` cannot be validated from capabilities without creating a second schema language, v1 ships
only named conditions and `--after-revision`.

## Capabilities and version negotiation

`app capabilities` is the machine-readable discovery point. It reports at least:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "revision": 44,
    "appVersion": "0.14.6",
    "cliVersion": "0.14.6",
    "protocolVersion": 1,
    "commands": [],
    "features": {}
  }
}
```

The three versions have different jobs:

- `schemaVersion` versions the CLI JSON envelope and result contracts.
- `protocolVersion` versions communication between the installed CLI and running app.
- app/CLI versions identify product builds for support and diagnostics.

Command and feature entries are descriptive capability data. An agent checks them instead of
assuming that a user's installed PLVS has every command introduced later.

## Future product controls

The next additions should follow actual user language and operate through the running app:

1. **Device Control** — list visible devices, inspect the active device, select a device, and report
   a failed or ambiguous selection. Example: "Use my USB interface instead of system output."
2. **Configuration Control** — export, validate/preview, and import the complete configuration
   through the app's existing UI semantics. Example: "Back up my PLVS setup before we change it."
3. **Loudness Profile Control** — list, inspect, create, edit, duplicate, delete, activate, import,
   and export user loudness profiles. Example: "Create a -16 LUFS podcast profile and use it."
4. **Theme Control** — list, inspect, create, edit, duplicate, delete, activate, import, and export
   themes. Example: "Make the current theme easier to read in daylight."
5. **Incremental Workspace Control** — add, remove, move, and resize one panel without replacing a
   complete scene. Example: "Put a vectorscope beside the loudness meter."
6. **Meter Inspection and Waiting** — read a bounded, timestamped measurement snapshot and wait for
   user-meaningful thresholds. Example: "Tell me when true peak exceeds -1 dBTP."

Theme and Loudness Profile editors have draft/preview/save/cancel semantics. Their CLI mutations
must pass through the same `useBlockingEditor` protection as UI scene operations and must never
silently discard an open draft.

Per-item import/export uses the approved pack formats and merge-only behavior in
`2026-09-05-item-transfer-design.md`. Whole configuration remains a distinct replacement workflow.

## Internal capture verification

Removing public `capture`, `devices`, and `analyze` must not weaken release verification.

`npm run smoke:capture`, `npm run soak:capture`, and `npm run release:preflight` continue to exercise
the real capture path on the VB-Cable/VLC rig. Their command entrypoint moves into repository-owned
test tooling that is neither installed nor advertised. The harness may reuse Rust library modules,
but it is not accepted by the public CLI parser.

The migration must preserve:

- stable device selection for the rig;
- synthesized-file ground truth used by capture smoke;
- timed samples and final summary records used by soak;
- stale release-binary detection;
- current release gate behavior and failure codes;
- explicit rejection of all-silence runs.

Because moving this entrypoint touches how the real capture layer is exercised, implementation is
not complete until capture smoke passes on the configured rig. The four-hour soak remains a
separate requested run after capture-layer or harness changes, following `AGENTS.md`.

## Implementation shape

The public parser and report layer should become small and explicit:

```text
plvs-cli
  doctor
  app
    query/control parser
    authenticated transport client
    v1 envelope renderer
    exit-code mapper
```

The Rust/React boundary remains the authority for product operations. Rust should not recreate
frontend validation or directly mutate persistence to satisfy a CLI command.

A central contract module owns:

- schema version;
- success and error envelopes;
- stable error-code-to-exit-code mapping;
- revision parsing;
- JSON stdout and `--out` behavior.

Feature adapters provide only their typed `result`, `state`, or nested operation data. They do not
construct bespoke top-level reports.

## Migration plan

### 1. Pin the current surface

- Capture current root/app help, parser behavior, App Control report shapes, error reasons, and exit
  codes in migration tests.
- Inventory every script, installer hook, generated page, and test that calls a removed command.
- Record the current domain revisions and which visible changes advance each one.

### 2. Introduce the v1 contract foundation

- Add the common envelope and one error/exit mapper.
- Migrate argument and transport failures into structured errors.
- Add the global public control revision and expose it in inspect/capabilities.
- Accept `--expected-revision` on every mutation and reject omission with `revisionRequired`.
- Keep revision comparison and mutation atomic inside the running app.

### 3. Migrate existing App Control families

- Normalize query results around `revision`.
- Normalize state mutations around `changed`, `revision`, and final `state`.
- Remove domain-specific revision flags in favor of `--expected-revision`.
- Verify every state mutation supports truthful dry-run.
- Classify transport commands as state mutations or actions and normalize their results.
- Migrate wait to the state-wait contract without exposing an arbitrary expression evaluator.

Because the stable v1 contract has not yet begun, old App Control JSON and flag names are removed
without aliases in this migration.

### 4. Migrate doctor

- Wrap the diagnostic report in the common envelope.
- Preserve complete reports for unhealthy installations.
- Pin warning/error aggregation and the documented exit-code exception.
- Update installer verification and discovery examples.

### 5. Remove early public commands

- Delete parser branches, help topics, docs, and public report types for `probe`, `analyze`,
  `analyze-batch`, `report`, `capture`, `devices`, and `profile`.
- Keep shared application and diagnostic implementation where still used.
- Ensure removed names fail as `unknownCommand` with exit `3` in JSON mode.

### 6. Move release-only audio tooling

- Add an internal capture harness and switch smoke/soak scripts to it.
- Retain ground-truth analysis internally without exposing a user command.
- Run focused script tests, real `smoke:capture`, and the applicable soak workflow.

### 7. Publish and guard v1

- Rewrite `docs/cli.md` around `doctor` and `app`.
- Update Agent Control pages and generated references through their generator.
- Add golden contract fixtures for success, error, mutation, dry-run, wait, and doctor.
- Add coverage that every public mutation requires revision and declares dry-run support or its
  action classification.
- Add a root-surface test that rejects accidental standalone commands.
- Run `npm run check`, installer verification, and the real Agent Control acceptance matrix.

## Acceptance criteria

CLI v1 is ready when:

1. Root help exposes only `doctor`, `app`, help, and version.
2. Removed standalone commands are unreachable in installed and source entrypoints.
3. All JSON commands use the v1 envelope and produce clean stdout.
4. All `app` queries return the current global revision.
5. Every mutation rejects a missing or stale `--expected-revision` before mutation.
6. Every state mutation has a side-effect-free dry-run with the same pure validation.
7. Mutations return their relevant final state, and no-ops return `changed: false`.
8. App unavailable, input, state refusal, wait, and runtime failures map to the documented exit
   classes and stable error codes.
9. Agent Control off immediately rejects every `app` command; turning it on restores access without
   restart.
10. `doctor` remains useful with PLVS closed and reports an unhealthy installation in full.
11. Release capture smoke and soak retain their current real-path coverage through internal tooling.
12. Existing user-visible App Control functions remain controllable after the contract migration.
13. `npm run check` and installer verification pass.

## Explicit non-goals

- Starting or installing PLVS from an `app` command.
- Headless media analysis, batch processing, or live metering.
- A developer-only public command family.
- Direct edits to PLVS persistence while the app is closed.
- MCP transport in this change.
- A general-purpose query or expression language.
- Adding Theme, Loudness Profile, Device, Configuration, operation, or meter commands as part of the
  cleanup itself. Their naming and contract slots are reserved here; each ships with its product
  workflow and tests.
