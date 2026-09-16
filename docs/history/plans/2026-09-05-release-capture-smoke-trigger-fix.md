# Release Capture Smoke Trigger Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run release capture smoke whenever production capture code or its smoke harness changes.

**Architecture:** Keep the existing pure Git path filter, rename its public constants/functions to
match capture-smoke semantics, and expand its explicit allowlist to every direct harness component.

**Tech Stack:** Node.js, Vitest

---

### Task 1: Expand capture-smoke dependency detection

**Files:**

- Modify: `scripts/audio-code-changed.test.mjs`
- Modify: `scripts/audio-code-changed.mjs`
- Modify: `scripts/run-release-gate.mjs`

- [x] Update the path-filter test to import `CAPTURE_SMOKE_PATHS` and
      `filterCaptureSmokePaths`, then expect the full approved list.

- [x] Add representative harness and script paths to the mixed-input assertion:

```js
expect(
  filterCaptureSmokePaths([
    "src-tauri/src/harness_main.rs",
    "src-tauri/src/cli_capture.rs",
    "scripts/capture-rig.mjs",
    "scripts/smoke-capture.mjs",
  ]),
).toHaveLength(4);
```

- [x] Run:

```powershell
npm test -- --run scripts/audio-code-changed.test.mjs
```

Expected: FAIL because the renamed exports and expanded list do not exist.

- [x] Rename `AUDIO_PATHS` to `CAPTURE_SMOKE_PATHS`, rename `filterAudioPaths` to
      `filterCaptureSmokePaths`, and add the approved paths.

- [x] Update `audioChangesSinceLastTag()` and `run-release-gate.mjs` to use capture-smoke wording.

- [x] Re-run the focused test and confirm it passes.

- [x] Run:

```powershell
npm run check
git diff --check
```

Expected: the complete merge gate and whitespace validation pass.

- [x] Commit:

```powershell
git add scripts/audio-code-changed.mjs scripts/audio-code-changed.test.mjs scripts/run-release-gate.mjs docs/superpowers/plans/2026-09-05-release-capture-smoke-trigger-fix.md
git commit -m "fix(release): guard capture smoke dependencies"
```
