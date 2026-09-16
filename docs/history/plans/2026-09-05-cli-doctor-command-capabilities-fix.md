# CLI Doctor Command Capabilities Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doctor advertise exactly the command families accepted by CLI v1.

**Architecture:** Keep Doctor's existing static informational check. Lock its public command list
with a unit test, then replace the obsolete entries with `doctor` and `app`.

**Tech Stack:** Rust, serde_json, Cargo test

---

### Task 1: Correct Doctor command discovery

**Files:**

- Modify: `src-tauri/src/doctor.rs`

- [x] Add a test to the existing `doctor.rs` test module:

```rust
#[test]
fn capabilities_report_only_public_cli_commands() {
  let check = check_capabilities();
  assert_eq!(check.details["commands"], json!(["doctor", "app"]));
}
```

- [x] Run:

```powershell
npm run rust:test -- doctor::tests::capabilities_report_only_public_cli_commands
```

Expected: FAIL because the current array contains the removed commands.

- [x] Replace the `commands` array in `check_capabilities()`:

```rust
"commands": ["doctor", "app"],
```

- [x] Re-run the focused test and confirm it passes.

- [x] Run:

```powershell
npm run check
git diff --check
```

Expected: the complete merge gate and whitespace validation pass.

- [x] Commit:

```powershell
git add src-tauri/src/doctor.rs docs/superpowers/plans/2026-09-05-cli-doctor-command-capabilities-fix.md
git commit -m "fix(cli): report current doctor commands"
```
