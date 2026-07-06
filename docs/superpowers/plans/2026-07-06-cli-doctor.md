# PLVS CLI Doctor Implementation Plan

> **For agentic workers:** implement task-by-task. Keep this plan updated with checkbox progress if work spans multiple turns.

**Goal:** Add the first agent-oriented PLVS CLI surface: `plvs-cli doctor --json`, which reports installed-runtime health as structured JSON without launching the desktop UI.

**Spec:** `docs/superpowers/specs/2026-07-06-cli-doctor-design.md`

**Architecture:** Add a reusable Rust `doctor` module inside the `app_lib` crate, plus a separate console binary at `src-tauri/src/bin/plvs-cli.rs`. The desktop `plvs.exe` remains a GUI app. The CLI binary calls the public doctor API, prints JSON, and sets exit codes. The doctor module may reuse private crate internals such as the existing FFmpeg sidecar locator, but those internals should not be made public just for the CLI.

---

## Decisions Locked In

- First command: `plvs-cli doctor --json`.
- First release supports JSON only; no human-readable output yet.
- `plvs.exe` remains the desktop/Tauri app binary.
- `plvs-cli.exe` is the console/agent binary.
- Missing `ffmpeg` or `ffprobe` is a `warning`, not a process failure.
- Config/data directory write failures are `error`.
- `warning` report status exits `0`; `error` report status exits `1`; invalid CLI/internal failure exits `2`.
- Do not add `plvs analyze`, MCP, UI diagnostics, audio device checks, or developer repository checks in this slice.

---

## Task 1: Add Pure Doctor Report Model and Status Aggregation

**Files:**

- Create: `src-tauri/src/doctor.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add `pub mod doctor;` to `src-tauri/src/lib.rs`.
- [x] In `doctor.rs`, define serializable public report structs:
  - `DoctorReport`
  - `DoctorSummary`
  - `DoctorAppInfo`
  - `DoctorPlatformInfo`
  - `DoctorPaths`
  - `DoctorCheck`
- [x] Use camelCase JSON field names where the spec requires them, e.g. `schemaVersion`, `executablePath`, `configDir`, `dataDir`.
- [x] Define check/report status values as string enums:
  - `ok`
  - `warning`
  - `error`
  - `skipped`
- [x] Implement a pure `aggregate_status(checks: &[DoctorCheck]) -> (DoctorStatus, DoctorSummary)` helper.
- [x] Add unit tests for aggregation:
  - all ok -> top-level `ok`;
  - warning only -> top-level `warning`;
  - any error -> top-level `error`;
  - skipped increments the summary but does not affect top-level status.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml doctor
```

---

## Task 2: Add Runtime Path Resolution and Writable Directory Checks

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/doctor.rs`

- [x] Decide whether a direct path-directory dependency is needed. First implementation uses platform environment variables directly, so no new dependency was added.
- [x] Implement path resolution for installed PLVS runtime directories:
  - Windows config dir: `%APPDATA%\com.soundoer.plvs`
  - Windows data/log dir: `%LOCALAPPDATA%\com.soundoer.plvs`
  - macOS equivalents should follow the same `com.soundoer.plvs` identity where the selected crate maps platform conventions.
- [x] Keep the path helper small and testable. Do not require a live Tauri `AppHandle`.
- [x] Implement `check_writable_dir(path)`:
  - create the directory if missing;
  - write a tiny `.plvs-doctor-write-test` file;
  - delete the test file;
  - return structured details including `path`, `exists`, and `writable`.
- [x] Add checks:
  - `config-directory-writable`, failure severity `error`;
  - `data-directory-writable`, failure severity `error`.
- [x] Add unit tests for the writable-dir helper using a temporary directory.
- [ ] Add a test for unwritable/invalid-path behavior where it is practical without platform-specific flakiness.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml doctor
```

---

## Task 3: Add App, Platform, and Sidecar Checks

**Files:**

- Modify: `src-tauri/src/doctor.rs`

- [x] Implement app info:
  - `name: "PLVS"`;
  - `version: env!("CARGO_PKG_VERSION")`;
  - `executablePath` from `std::env::current_exe()`.
- [x] Implement platform info:
  - `os` from `std::env::consts::OS`;
  - `arch` from `std::env::consts::ARCH`.
- [x] Add informational checks:
  - `app-info`;
  - `platform-info`.
- [x] Reuse `crate::file_analysis::ffmpeg::locate::locate_sidecar` for sidecar paths.
- [x] Implement `check_sidecar(stem)`:
  - resolve path;
  - check `exists`;
  - run `<sidecar> -version` or equivalent lightweight command;
  - on Windows, apply `CREATE_NO_WINDOW` like existing FFmpeg process launches;
  - capture a short version line if available;
  - set `fileAnalysisAvailable: false` when either sidecar check fails.
- [x] Add sidecar checks:
  - `ffmpeg-sidecar`, failure severity `warning`;
  - `ffprobe-sidecar`, failure severity `warning`.
- [ ] Unit-test sidecar path/status construction with `PLVS_FFMPEG_DIR` pointing at a temporary directory.
- [ ] Keep tests that execute real sidecars conditional/skippable if the binaries are not present.

**Verification:**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml doctor
```

---

## Task 4: Add `plvs-cli` Binary and Argument Handling

**Files:**

- Create: `src-tauri/src/bin/plvs-cli.rs`

- [x] Add a Cargo-discovered binary at `src-tauri/src/bin/plvs-cli.rs`.
- [x] Parse only the first supported command:

```powershell
plvs-cli doctor --json
```

- [x] Treat these as invalid arguments with exit code `2`:
  - missing command;
  - unknown command;
  - `doctor` without `--json`;
  - unsupported flags.
- [x] On valid arguments:
  - call `app_lib::doctor::run_doctor()`;
  - pretty-print or compact-print JSON consistently. Prefer compact JSON for agents unless tests choose otherwise;
  - write JSON to stdout;
  - exit `0` for report status `ok` or `warning`;
  - exit `1` for report status `error`.
- [x] Write user-facing argument errors to stderr in English.
- [x] Add Rust tests for argument parsing as pure helpers if parsing is factored out.

**Verification:**

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- doctor --json
```

Expected: JSON report on stdout and exit code `0` or `1` depending on the local environment.

---

## Task 5: Packaging and Installer Inclusion

**Files:**

- Modify as needed after checking Tauri bundler behavior:
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.windows.conf.json`
  - `src-tauri/tauri.macos.conf.json`
  - release/verification scripts if they need to assert the installed layout

- [x] Confirm whether Tauri 2 automatically builds/copies secondary Cargo binaries into the bundle. Do not assume it does.
- [x] Confirm Tauri includes the secondary Cargo binary automatically, so the installed layout includes:

```text
plvs.exe
plvs-cli.exe
ffmpeg.exe
ffprobe.exe
```

- [x] Keep `plvs-cli.exe` next to `plvs.exe` so the existing sidecar locator can find `ffmpeg.exe` and `ffprobe.exe`.
- [x] Do not add PATH integration in this first slice.
- [x] Add or update installer verification so packaged Windows output proves `plvs-cli.exe` is present next to the desktop binary.
- [x] If macOS packaging requires a different placement, document the exact installed path and ensure sidecar location still works from the CLI.

**Verification:**

```powershell
npm run desktop:build
```

Then inspect the packaged app/install output for `plvs-cli` and run:

```powershell
<installed-path>\plvs-cli.exe doctor --json
```

---

## Task 6: Focused Regression Gates

**Files:**

- No new files unless packaging verification scripts need updates.

- [x] Rust unit tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml doctor
```

- [x] CLI smoke test in dev build:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- doctor --json
```

- [x] Rust formatting/linting:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

- [x] If packaging files changed, run the existing relevant packaging verification command after `npm run desktop:build`.
- [x] Before merge, run full repo gate:

```powershell
npm run check
```

---

## Follow-Up Work

- Human-readable `plvs-cli doctor` output.
- PATH or launcher integration for easier user/agent discovery.
- Settings diagnostics UI using `doctor.rs`.
- MCP tool backed by `plvs-cli doctor --json`.
- `plvs analyze` after analysis session/report/persistence semantics are settled.
