# CLI v1 Global Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the CLI v1 global revision foundation so every existing `app` query exposes one public revision and no public response exposes domain revisions.

**Architecture:** Keep domain counters only where the React bridge needs them to observe settlement, while making `controlRevisionRef` the sole public concurrency token. Migrate one response family at a time with focused contract tests; mutation result normalization to boolean `changed` plus `state` remains a separate follow-up.

**Tech Stack:** React 19 hooks, Vitest, Rust, serde JSON

---

### Task 1: Finish broad query revision shapes

**Files:**
- Modify: `src/agentControl/appSnapshot.test.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/useAgentControlBridge.js`

- [ ] **Step 1: Write the failing tests**

Assert that both `app.inspect` and `app.capabilities` return a top-level non-negative `revision`,
and that neither result contains `revisions`.

- [ ] **Step 2: Run the tests to verify the contract fails**

Run:

```powershell
npm test -- --run src/agentControl/appSnapshot.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: `app.capabilities` lacks `revision`, and remaining bridge assertions against
`revisions.workspace` fail.

- [ ] **Step 3: Implement the minimal query changes**

Pass `controlRevisionRef.current` into the capabilities builder, return it as `revision`, retain the
current top-level `revision` in inspect, and remove the old domain revision arguments.

- [ ] **Step 4: Run the focused tests**

Run the command from Step 2. Expected: all tests pass.

### Task 2: Remove domain revisions from existing public results

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`

- [ ] **Step 1: Write failing response-shape tests**

For Dock and Preset query/mutation results, assert one top-level `revision` and absence of
`revisions`, `presetsRevision`, `settingsRevision`, and `transportRevision`.

- [ ] **Step 2: Run the bridge test and verify failure**

```powershell
npm test -- --run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: current Dock and Preset results expose legacy revision fields.

- [ ] **Step 3: Replace only public result fields**

Use `controlRevisionRef.current` for initial, dry-run, no-op, success, and committed-error results.
Do not delete internal domain counters that are still used to observe settlement.

- [ ] **Step 4: Run the bridge test**

Run the command from Step 2. Expected: all tests pass.

### Task 3: Guard the wire contract

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] **Step 1: Add one cross-domain revision test**

Inspect the app, change Workspace, Presets, Settings, and Transport in separate turns, and verify
that each observable change advances the same top-level revision while transient fullscreen state
does not.

- [ ] **Step 2: Run the test and verify its initial result**

```powershell
npm test -- --run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: fail if any domain still reports or compares an independent public token.

- [ ] **Step 3: Make the smallest bridge correction required**

Route any remaining public comparison or response through `controlRevisionRef`; preserve existing
settlement and persistence behavior.

- [ ] **Step 4: Run all Agent Control contract tests**

```powershell
npm test -- --run src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: all tests pass.

### Task 4: Verify the Rust CLI adapter

**Files:**
- Modify only if a focused test exposes a mismatch: `src-tauri/src/cli_app.rs`

- [ ] **Step 1: Run Rust adapter tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_app
```

Expected: all `cli_app` tests pass and successful responses preserve the frontend's top-level
`revision`.

- [ ] **Step 2: Check the complete diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only planned files are modified.

### Task 5: Prepare the next contract slice

**Files:**
- No production change in this task.

- [ ] **Step 1: Inventory mutation result families**

List each existing mutation that still returns a path array in `changed` or lacks the v1 `state`
field.

- [ ] **Step 2: Define the next independently testable batch**

Choose one family (Workspace/Panel/Axis, Preset, Settings, Transport, or Dock) and apply the same
red-green workflow. Do not combine mutation normalization with doctor migration or standalone
command removal.
