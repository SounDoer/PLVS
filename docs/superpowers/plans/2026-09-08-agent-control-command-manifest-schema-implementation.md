# Agent Control Command Manifest and Schema Export — Implementation Plan

> Proposed implementation plan. Implement only after the paired design is approved.

**Goal:** Consolidate the public CLI catalog into one cross-language manifest, expose offline
`schema list/get`, generate help and command-reference facts from the manifest, and close drift
gaps without changing existing Agent Control behavior.

**Architecture:** Store declarative command metadata in one JSON source imported by JavaScript and
embedded by Rust. Keep Rust parsing/request construction and frontend normalization/dispatch as the
execution authorities. Generate catalog surfaces from the manifest and use bidirectional tests to
prove the remaining executable paths cover it.

**Tech stack:** Rust/Serde, JavaScript ESM, Vitest, existing CLI JSON envelope, existing Agent
Control schema vocabulary and documentation snapshot workflow.

**Spec:**
`docs/superpowers/specs/2026-09-08-agent-control-command-manifest-schema-design.md`

---

## Phase A — Freeze the catalog without changing behavior

### Task 1: Define and validate the neutral manifest format

**Files:**

- Create: `src/agentControl/commandManifest.json`
- Create: `src/agentControl/commandManifest.js`
- Create: `src/agentControl/commandManifest.test.js`

- [ ] Add `manifestVersion: 1` and one entry for every existing public CLI leaf plus `doctor`.
      Reserve and test the offline-entry vocabulary without advertising `schema.list/get` before
      Task 6 implements them.
- [ ] Give each entry a unique ID, CLI path, family, usage, summary, execution class, operation
      class, wire mapping/feature gate where applicable, JSON/revision/dry-run/output policies,
      positionals, options, and top-level wire-parameter schema.
- [ ] Use references for deep/dynamic documents instead of copying Theme, Profile, Workspace,
      Settings, Panel, or configuration schemas.
- [ ] Reject unknown root/entry/schema fields, duplicate IDs/paths/wire methods, invalid policy
      combinations, empty summaries/usages, and offline entries with wire methods.
- [ ] Freeze the validated projection exposed to JavaScript consumers.
- [ ] Test representative query, mutation, action, wait, transfer, file/stdin, output-file, and
      feature-gated entries plus every invalid manifest invariant.

Run:

```powershell
npx vitest run src/agentControl/commandManifest.test.js
```

Expected: one deterministic validated catalog describes the current public surface without loading
React components or runtime state.

Commit:

```text
feat(agent-control): define command manifest
```

---

### Task 2: Add the Rust manifest model and build-time validation

**Files:**

- Create: `src-tauri/src/cli_manifest.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/Cargo.toml` only if a build-time Serde derive dependency is required

- [ ] Embed the exact repository manifest with `include_str!`; never search for it beside an
      installed binary.
- [ ] Add strict Serde models with denied unknown fields and public/internal projection helpers.
- [ ] Validate the same uniqueness and policy invariants as JavaScript.
- [ ] Make Cargo rebuild when the manifest changes and fail the build on malformed JSON.
- [ ] Confirm normal and `dev-identity` builds embed identical command catalogs.
- [ ] Add a stable manifest fingerprint or equality fixture only if needed for cross-language
      parity tests; do not expose the hash as a compatibility promise.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_manifest --no-fail-fast
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Rust and JavaScript accept and project the same source bytes, and malformed catalog data
cannot reach a release build.

Commit:

```text
feat(cli): load the shared command manifest
```

---

### Task 3: Replace handwritten CLI inventory and help assembly

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/cli_main.rs`
- Modify: `src-tauri/src/cli_manifest.rs`

- [ ] Derive recognized public families from manifest CLI paths instead of `COMMAND_NAMES`.
- [ ] Render canonical usage lines from manifest order instead of `base_help_text()` plus chained
      `replacen()` calls.
- [ ] Keep small handwritten root/family prose, Agent Control requirements, and exit-code text.
- [ ] Give `doctor` proper root help placement while keeping `--help`, `help`, and `--version` as
      parser meta operations. Task 6 adds `schema` help atomically with the working commands.
- [ ] Preserve every current usage spelling, bracket, enum, range, and command order unless the
      existing help was incomplete.
- [ ] Add exact coverage showing every manifest entry appears once in the appropriate help and no
      internal harness command appears.
- [ ] Keep command-specific parsing handwritten; do not refactor `ControlCommand` or request
      construction in this task.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_main::tests --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml cli_control::tests --no-fail-fast
```

Expected: help is manifest-driven while all existing argv and JSON-RPC request tests remain green.

Commit:

```text
refactor(cli): render command help from manifest
```

---

## Phase B — Close frontend catalog coverage

### Task 4: Derive potential capabilities from the manifest

**Files:**

- Modify: `src/agentControl/commandManifest.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/visualControl.js`
- Modify: `src/agentControl/visualControl.test.js`

- [ ] Replace the standalone frontend base `METHODS` inventory with running-app wire entries from
      the manifest.
- [ ] Preserve exact existing feature-gate behavior for `visual.describe`, screenshot, and recording
      lifecycle methods.
- [ ] Keep offline `doctor` and `schema` entries out of `app.capabilities.methods`.
- [ ] Derive Device/Visual catalog membership from manifest metadata where those arrays exist only
      to enumerate methods; retain explicit executable classifiers where clearer and assert they
      equal the manifest projection.
- [ ] Test base, unsupported Visual, screenshot-only, and screenshot-plus-recording capability
      projections.
- [ ] Confirm method ordering remains deterministic and compatible with current snapshots.

Run:

```powershell
npx vitest run src/agentControl/commandManifest.test.js src/agentControl/appSnapshot.test.js src/agentControl/protocol.test.js src/agentControl/visualControl.test.js
```

Expected: `app.capabilities` has unchanged meaning and no independently maintained global method
list remains in the frontend.

Commit:

```text
refactor(agent-control): derive capabilities from command manifest
```

---

### Task 5: Add bidirectional parser, normalizer, and bridge coverage

**Files:**

- Modify: `src-tauri/src/cli_manifest.rs`
- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src/agentControl/commandManifest.test.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: family fixture helpers only where needed to produce safe canonical requests

- [ ] Prove every Rust public `ControlCommand` leaf maps to exactly one manifest entry and wire
      method where applicable.
- [ ] Prove every manifest running-app entry can be normalized from a canonical safe request.
- [ ] Exercise advertised canonical requests through the mounted bridge and fail if any reaches
      `unsupportedMethod`.
- [ ] Use dry-run for mutations and mocked native/app owners for actions so the generic coverage test
      cannot mutate persistent user data.
- [ ] Keep detailed family tests; the generic inventory test supplements rather than replaces them.
- [ ] Add negative probes demonstrating that an orphaned manifest entry, parser mapping, normalizer,
      or advertised handler fails the appropriate guard.

Run:

```powershell
npx vitest run src/agentControl/commandManifest.test.js src/agentControl/protocol.test.js src/agentControl/useAgentControlBridge.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml cli_manifest cli_control --no-fail-fast
```

Expected: no public command can be added or removed on only one side of the CLI/frontend boundary.

Commit:

```text
test(agent-control): close command catalog coverage
```

---

## Phase C — Publish offline schema discovery

### Task 6: Add offline `schema list` and `schema get`

**Files:**

- Modify: `src-tauri/src/cli_main.rs`
- Modify: `src-tauri/src/cli_manifest.rs`
- Modify: `src-tauri/src/cli_contract.rs` only if reusable local success/error helpers are needed
- Modify: `src-tauri/src/cli_main.rs` tests

- [ ] Parse only `schema list --json` and `schema get <command-id> --json`, plus scoped help.
- [ ] Add `schema.list` and `schema.get` manifest entries in the same commit so generated help never
      advertises an unavailable command.
- [ ] Dispatch before Agent Control discovery so both commands work with PLVS closed or disabled.
- [ ] Return the standard schema-version-1 success/error envelope.
- [ ] Make `list` compact and `get` return the full public entry projection.
- [ ] Preserve manifest order and omit inapplicable fields rather than returning `null`.
- [ ] Reject missing IDs, unknown IDs, duplicate/unknown flags, `--out`, stdin, dry-run, and revision
      options locally with `invalidArguments` and exit 3.
- [ ] Bound optional unknown-ID suggestions and never select a command implicitly.
- [ ] Test broken-output/serialization behavior as exit 1 without contacting app discovery.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_manifest cli_main::tests --no-fail-fast
```

Expected: schema discovery is deterministic, offline, side-effect free, and uses the existing CLI
envelope and exit taxonomy.

Commit:

```text
feat(cli): export command schemas offline
```

---

### Task 7: Generate the public command reference

**Files:**

- Modify: `src/agentControl/publicSurfaceDocs.test.js`
- Create through generator: `docs/agent-control/generated/commands.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/cli.md`
- Modify: `scripts/cliDocumentationContract.test.js`

- [ ] Render command identity, CLI path, summary, execution/operation class, revision policy,
      dry-run/output policy, canonical usage, positionals, options, and schema references.
- [ ] Keep semantic workflows and safety explanations in handwritten pages.
- [ ] Document that static schema describes the installed CLI while capabilities/describe report the
      running app and dynamic state.
- [ ] Document offline behavior, version fields, errors, and copyable `schema list/get` examples.
- [ ] Remove remaining handwritten exhaustive inventories where the generated page is the better
      owner; retain concise family summaries.
- [ ] Add documentation-contract coverage for both commands and the generated-page link.
- [ ] Generate through `npm run docs:agent-control`; never hand-edit generated output.

Run:

```powershell
npm run docs:agent-control
npx vitest run src/agentControl/publicSurfaceDocs.test.js scripts/cliDocumentationContract.test.js
npx prettier --check scripts/cliDocumentationContract.test.js
```

Expected: public catalog facts come from the manifest and prose remains focused on semantics.

Commit:

```text
docs(agent-control): publish command schema discovery
```

---

## Phase D — Cleanup and release gate

### Task 8: Remove obsolete duplicate inventories

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/cli_main.rs`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/visualControl.js`
- Modify: tests and documentation only where they still depend on removed lists

- [ ] Search for handwritten command/family arrays, complete help usage blocks, and documentation
      tests that duplicate manifest facts.
- [ ] Remove only duplicates replaced by the manifest; retain domain sets used for executable
      classification or business branching.
- [ ] Confirm parser/request/normalizer code was not generalized merely for style.
- [ ] Confirm no generated file under `docs/agent-control/generated/` or `src/generated/` was edited
      manually.
- [ ] Run a repository search proving `app.capabilities` and help have no second global command
      inventory.

Run:

```powershell
rg -n "COMMAND_NAMES|const METHODS|base_help_text|plvs-cli visual recording start" src src-tauri/src
npx vitest run src/agentControl/commandManifest.test.js src/agentControl/appSnapshot.test.js src/agentControl/protocol.test.js
cargo test --manifest-path src-tauri/Cargo.toml cli_manifest cli_main cli_control --no-fail-fast
```

Expected: remaining command strings are command-specific parser/error logic or focused tests, not a
second public catalog.

Commit:

```text
refactor(agent-control): remove duplicate command inventories
```

---

### Task 9: Final automated and real-CLI verification

**Files:**

- Modify only if verification finds a defect.

- [ ] Run every focused Vitest and Rust suite named above.
- [ ] Run `npm run check`.
- [ ] Build the current development-identity CLI and run `schema list/get` with PLVS closed.
- [ ] Repeat with Agent Control disabled while PLVS is open and confirm no discovery occurs.
- [ ] Verify root help and every family help list exactly the manifest entries.
- [ ] Sample at least one command from every family and compare canonical argv/request output with
      the pre-change golden behavior.
- [ ] Verify unknown schema IDs/options return exit 3 and valid schema queries return exit 0.
- [ ] Verify `app.capabilities` against base and Visual feature combinations in a real Windows app.
- [ ] Confirm macOS CI compiles and tests the offline schema commands even though running-app Agent
      Control remains unavailable there.
- [ ] Inspect the final diff for command renames, wire changes, safety regressions, unrelated edits,
      and generated-file provenance.

Run:

```powershell
npm run check
npm run desktop:control -- schema list --json
npm run desktop:control -- schema get visual.recording.start --json
npm run desktop:control -- --help
```

Expected: static schema works offline, existing control behavior is unchanged, all catalog surfaces
agree, and the repository is ready for the next File wait/report or completion design.

Commit:

```text
test(agent-control): verify command manifest delivery
```

---

## Delivery order and stop conditions

Implement Tasks 1–9 in order and commit after each task. Phase A is behavior-preserving catalog
foundation; Phase B closes the cross-language safety net before the schema is made public; Phase C
publishes the additive CLI; Phase D removes leftovers and verifies the result.

Stop for a design decision if implementation evidence shows any of the following:

- one manifest shape cannot describe an existing command without changing accepted argv;
- the neutral JSON source would require runtime filesystem lookup or generated-file hand edits;
- deriving capabilities would change version-skew or Visual feature behavior;
- exhaustive bridge coverage would require bypassing business guards or mutating persistent data;
- a current public command has ambiguous revision/dry-run/output semantics that the manifest cannot
  truthfully state;
- build-time sharing breaks either Windows or macOS compilation.

Do not use those conflicts as permission to rename commands, weaken validators, broaden schemas, or
silently drop existing behavior.
