# Agent Control CLI: Next-Surface Roadmap

Date: 2026-09-06

Status: Brainstorm and sequencing proposal; not an approved public contract

## Why this document exists

Agent Control has reached the point where adding another command is mechanically straightforward,
but every public command also creates a compatibility and safety obligation. This note inventories
the useful gaps after the Library Transfer work and proposes an order that benefits both:

- people using PLVS from a terminal, scripts, stream-deck-style launchers, or support workflows;
- contributors and agents developing and testing PLVS itself.

The goal is not to mirror every button. A command belongs in the public CLI when it exposes a
stable product concept, has a real non-GUI workflow, and can preserve the same safety and
persistence semantics as the visible app.

## Current main baseline

The public CLI organizes commands directly by product resource or operation:

```text
plvs-cli doctor
plvs-cli inspect
plvs-cli panel ...
```

The running-app surface now covers:

- handshake and observation: `capabilities`, `inspect`, and revision `wait`;
- scene construction: Workspace, Panel, Axis, Preset, and Dock Control;
- global preferences: Settings Control;
- source lifecycle: live and file Transport Control;
- audio-source inventory, inspection, and exact/Automatic Device Control;
- bounded LIVE Measurement inspection and sample-identity waiting;
- persistent View Control and Windows Visual Capture;
- portable libraries: Preset, Theme, and Loudness Profile list/export/import;
- Loudness Profile inspection, authoring, selection, deletion, and ordering;
- Appearance inspection/selection and Theme inspection, authoring, duplication, deletion, and
  ordering;
- whole-setup Configuration Transfer.

The post-v0.15.0 work added Library Transfer end to end, including strict request validation,
revision tracking for Theme and Loudness Profile libraries, large named-pipe frame delivery,
durable settlement, recoverable `--out` failure behavior, and public documentation.

Important constraints of the current baseline:

- Agent Control is public only on Windows; macOS transport is not implemented.
- Running-app commands are machine-first and require `--json`.
- CLI `inspect` (wire method `app.inspect`) intentionally contains semantic state, not measurement
  frames or history.
- configuration reset, FILE measurement queries, raw history, and visual buffers are intentionally
  outside the existing contract.
- the internal `analyze` and `capture` harness commands are release-verification tools, not public
  CLI promises.

### Settings transfer audit

The Settings UI presents four transfer rows. Their current status is:

| Settings row      | GUI export/import | CLI export/import | Import behavior                                            |
| ----------------- | ----------------- | ----------------- | ---------------------------------------------------------- |
| Loudness Profiles | Complete          | Complete          | Append; preserve selection                                 |
| Presets           | Complete          | Complete          | Append; include required custom Theme/Profile dependencies |
| Theme             | Complete          | Complete          | Append; preserve active Theme                              |
| Everything        | Complete          | Complete          | Replace the whole setup and relaunch PLVS                  |

Therefore all four Settings transfer rows are complete in the CLI. Everything is represented
technically by the versioned `.plvsconfig` configuration profile; unlike the three libraries, it is
a whole-setup replacement rather than an append-only pack.

## Decision filter for new commands

Score a candidate against the following questions before designing it:

1. **User job:** Does it complete a task somebody reasonably performs without opening a panel?
2. **Developer leverage:** Does it replace fragile GUI setup or make an important behavior
   reproducible in tests and bug reports?
3. **Semantic owner:** Is there an existing app-layer operation to reuse, or can one be introduced
   without bypassing React state, native side effects, scene guards, or persistence settlement?
4. **Bounded output:** Can it return a compact stable document rather than canvas buffers,
   unbounded history, or implementation-shaped state?
5. **Concurrency:** Is the operation clearly a query, mutation, or action, with revision behavior
   that fits the current contract?
6. **Cross-platform meaning:** Does the command make sense on both product platforms, with explicit
   availability where OS behavior differs?
7. **Long-term support:** Would we still want to support its nouns and flags after the current UI is
   redesigned?

Commands that fail the semantic-owner or bounded-output test should not be exposed merely because
the underlying data is reachable.

## Agreed near-term focus

The current working priority is deliberately narrower than the candidate backlog below:

1. complete the fourth Settings transfer row with Configuration Transfer (done);
2. add Loudness Profile inspection and editing commands (done);
3. add Appearance and Theme inspection and editing commands (done);
4. add bounded Device Control with independent hotplug concurrency (done).
5. add Windows Visual Capture for screenshots and bounded MP4 recording (done).

Preset editing is not part of this new work: Preset Control already supports describe, save,
update, apply, rename, delete, and reorder. Its transfer commands are also complete.

### Stage 1: Everything transfer — complete

Implemented public shape:

```text
plvs-cli config export --json [--out <file>]
plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]
```

Use `config` in the CLI because it names the portable technical resource; keep **Everything** as the
friendlier Settings label. Both refer to the existing versioned `.plvsconfig` document.

`config export` must use the same profile builder as the GUI, flush pending persistence first, and
continue excluding `agentControlEnabled`. Its `--out` behavior should match library export: move the
pretty-printed document to the file while leaving a compact result on stdout, with the full document
recoverable from stdout if the file write fails.

`config import --dry-run` validates, migrates, and reports the normalized replacement without
writing or relaunching. A real import replaces the same domains and siblings as the GUI and then
relaunches PLVS. The implemented response lifecycle is:

1. validate the entire input and recheck `expectedRevision` before the first write;
2. persist the replacement through the existing native profile command;
3. send a successful result containing `relaunch: true`;
4. flush the Windows named pipe and wait until the CLI has read every response byte;
5. require the caller to rediscover and inspect rather than comparing revisions across sessions.

The delivery-aware response bridge makes step 4 an acknowledgement rather than a timing delay. A
successful response means the replacement was durably written; it does not claim the next process
has completed booting.

Do not include `config reset` in this stage. It is destructive, does not complete the requested
transfer parity, and deserves a separate confirmation design if terminal demand appears.

### Stage 2: Loudness Profile editing — complete

Approved design and completed implementation plan:

- [`superpowers/specs/2026-09-06-agent-control-loudness-profile-design.md`](superpowers/specs/2026-09-06-agent-control-loudness-profile-design.md)
- [`superpowers/plans/2026-09-06-agent-control-loudness-profile-implementation.md`](superpowers/plans/2026-09-06-agent-control-loudness-profile-implementation.md)

Implemented public shape:

```text
plvs-cli loudness-profile describe <id> --json
plvs-cli loudness-profile select <id|off> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]
```

Implemented GUI-matching semantics:

- create generates an ID, inserts the document, and selects it;
- update replaces the document in place and preserves the selection that existed before editing;
- select changes the working-scene Profile selection and dirties the active Preset when applicable;
- deleting the active Profile selects Off and removes matching references from every Preset;
- dry-run delete reports affected Preset IDs before mutation;
- create, update, rename, select, and delete are refused while the Profile editor draft is open;
- reorder changes only order and follows the GUI's existing draft behavior;
- every result settles both Settings and Presets when the operation touches both stores.

`describe` and mutation validation must use the same normalized rule-document model that powers the
editor preview and save path. Do not create an Agent-Control-only definition of a valid Profile.

### Stage 3: Theme editing — complete

Approved design and implementation plan:

- [`superpowers/specs/2026-09-06-agent-control-theme-control-design.md`](superpowers/specs/2026-09-06-agent-control-theme-control-design.md)
- [`superpowers/plans/2026-09-06-agent-control-theme-control-implementation.md`](superpowers/plans/2026-09-06-agent-control-theme-control-implementation.md)

Implemented public shape:

```text
plvs-cli theme inspect --json
plvs-cli theme describe <id> --json
plvs-cli theme select <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme follow-system --expected-revision <n> --json [--dry-run]
plvs-cli theme create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme duplicate <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme reorder <file|-> --expected-revision <n> --json [--dry-run]
```

Implemented GUI-matching semantics and ownership:

- built-in Themes are describable and duplicable/customizable, but not updateable or deletable;
- create and duplicate generate a new custom ID and select the new Theme, matching editor creation;
- update and rename preserve library position and current Appearance selection;
- deleting the active custom Theme must use the same fallback and persistence behavior as the GUI;
- Appearance belongs only to Theme Control: `select` chooses a fixed Theme and `follow-system`
  restores System mode; Settings describe/inspect/update expose no Appearance field or alias;
- select, follow-system, create, update, rename, duplicate, and delete are refused while the Theme
  editor is open; reorder and append-only import remain allowed;
- documents use the public Theme V2 authoring model, never compiled tokens, generated CSS, or editor
  widget state;
- commands touching both Settings and Themes settle once, increment the global revision once, and
  flush persistence once.

Theme picker/editor and Agent Control share the same pure planners and React-owned controller for
selection, save, duplication, deletion fallback, and repository ordering.

### Stage 4: Device Control — complete

Approved design and implementation plan:

- [`superpowers/specs/2026-09-07-agent-control-device-control-design.md`](superpowers/specs/2026-09-07-agent-control-device-control-design.md)
- [`superpowers/plans/2026-09-07-agent-control-device-control-implementation.md`](superpowers/plans/2026-09-07-agent-control-device-control-implementation.md)

Implemented public shape:

```text
plvs-cli device list --json
plvs-cli device inspect --json
plvs-cli device select <device-id|default> --expected-revision <n> --expected-generation <n> --json [--allow-measurement-restart] [--dry-run]
```

The first slice deliberately has no `device describe`: `list` is the bounded dynamic selection
schema. It accepts only exact IDs returned by the current list plus literal `default`. Requested
selection uses global revision, while inventory/hotplug changes use an independent generation and
do not wake unrelated waiters. Header, tray, and Agent Control share one React-owned asynchronous
selection path. Running Live changes require restart confirmation and settle through native capture
readiness; a restart failure retains and reports the newly persisted selection.

### Stage 5: Visual Capture — complete

Approved design and completed implementation plan:

- [`../superpowers/specs/2026-09-07-agent-control-visual-capture-design.md`](../superpowers/specs/2026-09-07-agent-control-visual-capture-design.md)
- [`../superpowers/plans/2026-09-07-agent-control-visual-capture-implementation.md`](../superpowers/plans/2026-09-07-agent-control-visual-capture-implementation.md)

The implemented Windows-only `visual` family provides `describe` and screenshot plus asynchronous
recording `start`, `inspect`, `wait`, and `stop`. It captures closed semantic targets, stages media
outside JSON, supports explicit silent recording, and defaults Live recording to the measured
source while File remains silent. The complete public contract is
[`agent-control/visual.md`](agent-control/visual.md).

## Broader candidate backlog

### Cross-platform and human-use foundation

This is foundation work rather than command breadth, but it has the highest product leverage.

#### macOS local transport

Implement the Unix-domain-socket transport already anticipated by the protocol design, preserving
the same descriptor, authentication, framing, timeout, and JSON-RPC semantics. Capability names and
CLI envelopes must remain platform-independent.

Why first: every later public command otherwise becomes a Windows-only feature despite PLVS's equal
Windows/macOS product intent.

#### Optional human-readable output

Keep `--json` exactly stable and continue requiring it for automation. Add an explicit human mode
for read-oriented commands instead of changing the current default contract, for example:

```text
plvs-cli inspect --format text
plvs-cli device list --format table
plvs-cli measurement inspect --format text
```

Mutation commands should remain JSON-first until their preview, warnings, and partial-failure
semantics can be rendered without hiding information. Color must be disabled when output is not a
TTY and by `NO_COLOR`.

#### Shell completions and documentation examples

Generate PowerShell, zsh, and bash completions from the real parser or a checked command manifest.
Do not maintain another handwritten command tree. Add copyable workflows, not merely one example
per leaf command.

### Other workflows that already exist in the GUI

These commands have strong user value and mostly reuse stable product objects.

#### 1. File-analysis report export

Proposed shape:

```text
plvs-cli transport file report <session-id> --json [--out <file>]
```

The GUI already builds a stable `fileAnalysis` report from a completed session. The CLI should call
the same builder and use Library Transfer's move-to-file `--out` semantics. Without `--out`, the
report lives in `result.report`; with it, stdout carries `result.out` and not a duplicate report.

Why it is a good first slice:

- it turns existing file analysis into an end-to-end terminal workflow;
- it is useful to users, support, release checks, and fixture generation;
- it exposes a bounded result rather than raw history;
- it requires no new measurement algorithm.

Open design question: whether report generation is a query or a file-writing action. The app-side
report is read-only, while the CLI-side `--out` write can still fail after a successful response.

### Bounded Measurement API — V1 complete

This is the largest new product capability and likely the most valuable to automation.

#### Latest semantic measurement

Implemented V1 shape:

```text
plvs-cli measurement describe --json
plvs-cli measurement inspect --json
```

V1 returns one coherent latest LIVE semantic sample, not frontend canvas data:

- capture/source state, sample timestamp, age, and trust/health status;
- per-channel peak and true peak;
- momentary, short-term, and integrated loudness plus LRA when available;
- correlation and other scalar Stats metrics already computed for the active analysis request;
- explicit `null` for conceptually present but unavailable values;
- the measurement generation or sequence used to prove fields came from one snapshot.

Do not add measurement changes to the global configuration revision. They are high-frequency data
and would break the existing optimistic-concurrency and revision-wait model.

File measurements remain a separate later slice; V1 deliberately has no `--source` option.

#### Runtime wait predicates — deferred

After the snapshot contract is stable:

```text
plvs-cli measurement wait <predicate-file|-> --timeout-ms <n> --json
```

Initial predicates should be a small allowlist, such as transport lifecycle, fresh-signal presence,
peak above/below a threshold, integrated loudness availability, and analysis completion. Avoid a
general expression language. Return the final coherent measurement snapshot that satisfied the
predicate.

This is a separate family from `wait`: revision wait observes low-frequency controllable
state; measurement wait observes runtime data. Conflating them would either busy-wake agents or
weaken the meaning of the global revision.

#### Explicit non-goal: raw history export in the first slice

History is multi-resolution, source-specific, potentially gigabytes large, and partly keyed by
panel analysis configuration. Do not expose internal slabs or `inspect --include-history`.
If a real user workflow emerges, design a separate bounded export with an explicit time range,
sample interval, metric list, maximum rows, and streaming/file semantics.

### Developer and power-user leverage

#### Machine-readable schema export

Proposed design and implementation plan:

- [`../superpowers/specs/2026-09-08-agent-control-command-manifest-schema-design.md`](../superpowers/specs/2026-09-08-agent-control-command-manifest-schema-design.md)
- [`../superpowers/plans/2026-09-08-agent-control-command-manifest-schema-implementation.md`](../superpowers/plans/2026-09-08-agent-control-command-manifest-schema-implementation.md)

Proposed shape:

```text
plvs-cli schema list --json
plvs-cli schema get <command-or-resource> --json
```

This should be generated from the schema builders and command manifest, not a raw dump of Rust or
React types. It enables validation, typed client generation, better completions, and a future MCP
adapter without making `capabilities` enormous.

#### Declarative batch/transaction

Proposed exploratory shape:

```text
plvs-cli batch <file|-> --expected-revision <n> --json [--dry-run]
```

A batch is valuable for repeatable test setup, but only if the whole plan can be validated before
the first mutation and committed with defined atomicity. A sequential macro that can fail halfway
is not a transaction and should not be named one. Start with operations that can share one
app-layer planner; do not attempt rollback of native side effects by replaying inverse commands.

#### Ergonomic workspace operations

Possible commands include panel add/remove/rename and tabs/split helpers. They are convenient for
humans, but lower priority because `workspace apply` is already complete and atomic. Prefer
CLI-side helpers that compile to the existing public layout document over new protocol methods,
provided they still require a caller-supplied expected revision and never auto-retry conflicts.

#### Public headless file analysis

There is clear user value in:

```text
plvs-cli analyze <audio-file> --json [quality-control options] [--out <file>]
```

The repository already has an internal analysis harness, but promoting it is not a parser change.
It needs a separately reviewed public report schema, version/sidecar compatibility, resource and
cancellation behavior, track-selection semantics, install footprint, and support policy. Public
analysis must not inherit rig-oriented flags or imply that the capture harness is supported.

#### Diagnostic support bundle

Possible shape:

```text
plvs-cli doctor bundle --out <archive>
```

This could package the doctor report, version/build metadata, sanitized configuration, recent
user-visible errors, and device capabilities. It must preview exactly what will be included, redact
paths/device names where appropriate, contain no audio or measurement history by default, and
remain fully local. This is useful but exceeds the PRD's current minimum diagnostic commitment.

### Consider only after concrete demand

- **Window commands:** show/hide, focus, bounds, Always On Top, and Focus View are useful for kiosk
  launchers, but are intrusive OS actions and partially overlap Presets/Dock.
- **Screenshot/export image:** useful for support and reports, but platform reliability, window
  visibility, DPI, sensitive content, and completion-after-paint need a dedicated contract.
- **Update install/restart:** high-impact network and lifecycle actions should not be added merely
  because the GUI has buttons.
- **MCP host:** `plvs-cli mcp` can reuse the command schemas after the measurement and editing
  surfaces settle. It should adapt the public semantic API, not become a second control API.
- **Multi-session selection:** only when PLVS supports or users demonstrably run multiple
  controllable instances. Preserve room for `--session` in discovery design.

## Commands not to expose

The following remain internal even if they are convenient during implementation:

- raw Tauri `invoke`, Event, Channel, reducer action, persistence key, or JavaScript forwarding;
- arbitrary file read/write or shell execution through the running app;
- internal capture-harness commands and callback-thread diagnostics;
- raw history slabs, canvas buffers, WebView DOM state, hover state, or generated CSS;
- an option that disables revision checks, silently retries conflicts, or discards an open draft;
- direct store mutation that bypasses the React state owner;
- generic expression evaluation for waits.

## Proposed delivery order

The smallest useful sequence is:

1. **Command manifest and offline schema foundation:** consolidate catalog facts, generate help and
   command reference, and expose `schema list/get` before adding more command families.
2. **Cross-platform and human-use foundation:** macOS transport, explicit text rendering for
   queries, and generated completions.
3. **File report export** as the next already-visible GUI workflow after the foundations.
4. **Batch execution** only after at least two external consumers need it and atomicity can be
   defined honestly.
5. Re-evaluate public headless analysis, support bundles, MCP, and window control from
   actual usage rather than surface-completeness pressure.

Configuration Transfer, Loudness Profile Control, Theme Control, Device Control, Measurement
inspect/wait, and Visual Capture are complete on the existing Windows transport. Track macOS parity
as a release blocker for claiming the expanded Agent Control CLI is cross-platform.

## Definition of done for every new family

Every approved command family should include:

- one semantic owner shared with the GUI, with no direct engine access from components and no
  persistence writes behind React;
- strict unknown-field rejection, payload/time/count bounds, and stable machine-readable errors;
- query/mutation/action classification, revision rules, dry-run behavior, and no-op behavior;
- blocking-editor and destructive-confirmation behavior before any mutation;
- durable-settlement semantics and explicit reporting when visible state changed but persistence
  did not settle;
- capabilities advertisement and a coverage guard tying advertised commands to handlers;
- CLI parser, stdin/file, JSON envelope, exit-code, and output-file tests;
- frontend planner and bridge tests, including refusal before mutation;
- generated or hand-written public docs as appropriate, plus documentation contract coverage;
- real desktop acceptance on every supported transport;
- `npm run check` before merge, and capture smoke/soak only when the capture/DSP/engine boundary is
  actually crossed.

## Immediate design recommendation

The next implementation stage is the **command manifest and offline schema foundation**. It closes
the catalog drift risk before more command families are added and provides the checked input for
future help, completion, SDK, and MCP work. Configuration Transfer, Loudness Profile Control, Theme
Control, Device Control, Measurement inspect/wait, and Visual Capture are complete. macOS transport
remains the next product-portability foundation, and File-analysis report export remains the next
user-workflow command-family candidate.
