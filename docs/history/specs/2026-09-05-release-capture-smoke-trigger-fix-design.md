# Release Capture Smoke Trigger Fix

Date: 2026-09-05
Status: Approved

## Problem

Release preflight decides whether to run real capture smoke by looking only under the Rust
`audio`, `dsp`, and `engine` directories. Changes to the harness command path or the smoke rig
itself can therefore alter what is tested while preflight reports that no audio code changed and
skips the test.

## Design

Rename the path set to describe its real purpose: capture-smoke dependencies. Retain the three
capture directories and add the harness entry, command parsing/execution modules, report
serialization, and the two scripts used by capture smoke.

The exact guarded paths are:

- `src-tauri/src/audio`
- `src-tauri/src/dsp`
- `src-tauri/src/engine`
- `src-tauri/src/harness_main.rs`
- `src-tauri/src/cli_main.rs`
- `src-tauri/src/cli_capture.rs`
- `src-tauri/src/cli_analyze.rs`
- `src-tauri/src/cli_report.rs`
- `scripts/capture-rig.mjs`
- `scripts/smoke-capture.mjs`

Do not include UI, documentation, soak-only scripts, or all Rust dependencies. This keeps hardware
preflight proportional while ensuring that changes capable of altering capture-smoke execution
cannot skip it.

## Tests

Update the pure path-filter tests to assert every dependency above is selected and representative
unrelated files remain excluded. No hardware is needed for these tests.
