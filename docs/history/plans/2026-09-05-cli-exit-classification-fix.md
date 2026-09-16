# CLI Exit Classification Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map every currently emitted public app-control error to the documented CLI exit class.

**Architecture:** Preserve the existing explicit public-code match in `CliAppFailure::app` and extend its input/resource and current-state groups. Pin the groups with one table-driven Rust test.

**Tech Stack:** Rust, serde_json, Cargo test

---

### Task 1: Pin feature-specific exit classes

**Files:**
- Modify: `src-tauri/src/cli_app.rs`

- [ ] Add current resource codes to the table with exit `3`: `panelNotFound`, `axisNotFound`,
  `presetNotFound`, `fileSessionNotFound`, `dockPanelNotFound`, and `monitorNotFound`.
- [ ] Add current refusal codes with exit `4`: `controlUnavailable`, `controlsUnavailable`,
  `axisUnavailable`, `transitionInProgress`, `analysisInProgress`, `dockActive`, `fileModeActive`,
  `fileAnalysisNotActive`, `confirmationRequired`, and `channelConfigurationChanged`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml stable_app_error_classes_map_to_the_v1_exit_contract`.
- [ ] Confirm the new cases fail with actual exit `1`.

### Task 2: Extend the explicit mapper

**Files:**
- Modify: `src-tauri/src/cli_app.rs`

- [ ] Add the missing resource names to the exit `3` match arm.
- [ ] Add the missing state-refusal names to the exit `4` match arm.
- [ ] Keep unknown errors at exit `1`.
- [ ] Re-run the focused Rust test and confirm it passes.

### Task 3: Verify and commit

- [ ] Run `npm run check`.
- [ ] Run `git diff --check`.
- [ ] Review the final diff.
- [ ] Commit with `fix(cli): classify app-control exit codes`.
