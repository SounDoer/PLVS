# Capture Harness Build Detection Fix

Date: 2026-09-05
Status: Approved

## Problem

Production and capture-harness builds temporarily occupy the same
`src-tauri/target/release/plvs.exe` path. `locateHarness()` checks only existence and source
freshness, so it can accept a fresh production build that deliberately excludes the
`capture-harness` feature. Smoke or soak then fails only after attempting an internal command,
misdiagnosing a build prerequisite as a capture-rig failure.

## Design

After locating the binary, run the side-effect-free probe:

```text
plvs.exe --harness capture --help
```

A harness-enabled build prints help and exits successfully. A production build exits with the
existing “capture harness is not available” error. Reject any failed probe immediately with the
exact harness build command, then perform the existing source-freshness check.

Keep production builds feature-free. This change only prevents smoke and soak from consuming the
wrong build.

## Tests

Factor the probe into a small exported function with an injectable command runner. Assert that it
uses the expected arguments, accepts exit zero, and rejects a feature-free result with an
actionable rebuild message. The real `locateHarness()` invokes that function before returning.
