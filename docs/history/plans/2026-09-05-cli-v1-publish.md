# CLI v1 Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the implemented CLI v1 contract accurately and guard its public command surface and stable JSON shapes.

**Architecture:** Keep `docs/cli.md` as the installed CLI entry point and `docs/agent-control/` as the detailed live-control reference. Pin common envelope examples in a shared JSON fixture consumed by Rust tests; keep generated panel, axis, and settings pages unchanged unless their schema builders change.

**Tech Stack:** Markdown, Rust/serde JSON, Vitest file snapshots

---

### Task 1: Guard the root help and v1 envelopes

**Files:**
- Modify: `src-tauri/src/cli_main.rs`
- Modify: `src-tauri/src/cli_contract.rs`
- Create: `shared/cli-v1-envelope-fixtures.json`

- [ ] **Step 1: Add failing assertions**

Assert that root help lists exit codes `0` through `5`, only `doctor` and `app` are public roots,
and fixture cases satisfy `{ schemaVersion, ok, result|error, exitCode }`.

- [ ] **Step 2: Verify the focused test fails**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_contract
cargo test --manifest-path src-tauri/Cargo.toml cli_main
```

Expected: root help lacks exit classes `3`–`5`, and the shared fixture reader does not exist.

- [ ] **Step 3: Implement the minimal contract guard**

Move no command behavior. Add the fixture reader test to `cli_contract.rs` and update root help to
the six v1 exit classes.

- [ ] **Step 4: Re-run focused Rust tests**

Run the Step 2 commands. Expected: all focused tests pass.

### Task 2: Rewrite the installed CLI guide

**Files:**
- Modify: `docs/cli.md`

- [ ] **Step 1: Replace the old standalone-oriented guide**

Document only:

```text
plvs-cli doctor
plvs-cli app ...
```

Include installation/discovery, the common JSON envelope, doctor's `ok: true`/exit `1` exception,
global revision workflow, mutation/action distinction, wait, tee output, exit codes `0`–`5`, and
development usage.

- [ ] **Step 2: Verify removed commands are absent**

```powershell
rg -n "plvs-cli (probe|analyze|analyze-batch|capture|devices|profile|report)" docs/cli.md
```

Expected: no matches.

### Task 3: Update the Agent Control contract reference

**Files:**
- Modify: `docs/agent-control/README.md`
- Modify: `docs/agent-control/wait.md`
- Modify: `docs/agent-control/transport.md`
- Modify: `docs/agent-control/settings.md`
- Modify: `docs/agent-control/presets.md`
- Modify: `docs/agent-control/dock.md`
- Modify: `docs/agent-control/axes.md`

- [ ] **Step 1: Replace domain revision terminology**

Use one top-level `revision`, one CLI flag `--expected-revision`, and one wait baseline
`--after-revision`.

- [ ] **Step 2: Normalize result examples**

State mutations use:

```json
{ "dryRun": false, "changed": true, "revision": 1, "state": {} }
```

Transport actions use:

```json
{ "action": "transport.live.start", "status": "completed", "revision": 1, "state": {} }
```

- [ ] **Step 3: Search for legacy contract fields**

```powershell
rg -n "expected-(workspace|presets|settings|transport)-revision|revisions\\.|changedDomains|\"changed\": \\[" docs/agent-control
```

Expected: no success-result or public-flag matches; path arrays may remain only in documented error
details.

### Task 4: Verify generated references and the complete gate

**Files:**
- Verify only: `docs/agent-control/generated/*.md`

- [ ] **Step 1: Run the generated-doc snapshot guard**

```powershell
npm test -- --run src/agentControl/publicSurfaceDocs.test.js
```

Expected: all snapshots pass without rewriting generated files.

- [ ] **Step 2: Run the complete merge gate**

```powershell
npm run check
git diff --check
git status --short
```

Expected: all checks pass and only the planned fixture, contract guard, plan, and hand-written docs
are modified.
