# PLVS CLI Analyze Implementation Plan

> **For agentic workers:** implement task-by-task. Keep this plan updated with checkbox progress if work spans multiple turns.

**Goal:** Add `plvs-cli analyze <path> --json`, a summary-only agent command that analyzes a local media file without launching the desktop UI.

**Spec:** `docs/superpowers/specs/2026-07-06-cli-analyze-design.md`

---

## Decisions Locked In

- First command shape: `plvs-cli analyze <path> --json`.
- JSON only in this slice.
- Summary-only output: source metadata, decoded frame count, and final delivery metrics.
- Non-finite metric values serialize as `null`.
- Missing/unreadable files and decode failures return JSON with `status: "error"` and exit code `1`.
- Invalid CLI usage exits `2`.
- Do not add report-file output, streamed progress, track selection, persisted sessions, history data, or UI diagnostics in this slice.

---

## Task 1: Expose a Summary-Only Rust Analysis API

**Files:**

- Modify: `src-tauri/src/file_analysis/session.rs`

- [x] Add a public result struct for summary-only file analysis.
- [x] Add a public function that wraps `analyze_file_core()` with default CLI settings.
- [x] Keep desktop `FileAnalysisSession` behavior unchanged.
- [x] Keep analysis requests empty; the CLI first slice should not compute request-keyed visual data.
- [x] Keep dialogue gating disabled in this slice.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml file_analysis::session
```

---

## Task 2: Add CLI Analyze Report Model

**Files:**

- Create: `src-tauri/src/cli_analyze.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add `pub mod cli_analyze;`.
- [x] Define serializable success and error reports with `schemaVersion`, `command`, `status`, `app`, and structured payload fields.
- [x] Convert non-finite metrics to `None` so JSON emits `null`.
- [x] Compute `samplePeakMaxDb` as the max of left/right finite sample peaks.
- [x] Add focused unit tests for metric sanitization and report status.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze
```

---

## Task 3: Wire `plvs-cli analyze`

**Files:**

- Modify: `src-tauri/src/bin/plvs-cli.rs`

- [x] Parse `analyze <path> --json`.
- [x] Reject missing path, missing `--json`, unknown flags, and extra positional arguments.
- [x] Print success JSON to stdout and exit `0`.
- [x] Print analysis error JSON to stdout and exit `1`.
- [x] Keep CLI usage/internal errors on stderr with exit `2`.
- [x] Add pure parser tests.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --bin plvs-cli
```

---

## Task 4: Focused Regression Gates

- [x] Rust tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze file_analysis::session
cargo test --manifest-path src-tauri/Cargo.toml --bin plvs-cli
```

- [x] CLI smoke test on an existing or generated media fixture:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- analyze <fixture.wav> --json
```

- [x] Formatting and linting:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
