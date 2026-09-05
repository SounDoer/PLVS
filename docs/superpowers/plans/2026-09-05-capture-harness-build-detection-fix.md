# Capture Harness Build Detection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop capture smoke and soak before they mistake a production binary for a harness build.

**Architecture:** Probe the located executable with the side-effect-free harness Capture help
command. Keep the process invocation injectable in the focused unit test while `locateHarness()`
uses the real runner.

**Tech Stack:** Node.js, Vitest

---

### Task 1: Verify the located binary is harness-enabled

**Files:**

- Modify: `scripts/capture-rig.test.mjs`
- Modify: `scripts/capture-rig.mjs`

- [x] Add tests for a `verifyHarnessBuild(path, runner)` helper:

```js
it("accepts a harness-enabled build", () => {
  const run = vi.fn(() => ({ status: 0, stdout: "help", stderr: "" }));
  expect(() => verifyHarnessBuild("plvs.exe", run)).not.toThrow();
  expect(run).toHaveBeenCalledWith("plvs.exe", ["--harness", "capture", "--help"]);
});

it("rejects a production build", () => {
  const run = vi.fn(() => ({
    status: 2,
    stdout: "",
    stderr: "The capture harness is not available in this build.",
  }));
  expect(() => verifyHarnessBuild("plvs.exe", run)).toThrow(/--features capture-harness/);
});
```

- [x] Run:

```powershell
npm test -- --run scripts/capture-rig.test.mjs
```

Expected: FAIL because `verifyHarnessBuild` is not exported.

- [x] Implement the helper:

```js
export function verifyHarnessBuild(harness, run = runCli) {
  const probe = run(harness, harnessArgs(["capture", "--help"]));
  if (probe.status !== 0) {
    throw new RigError(
      `The Release binary was not built with the capture harness.\nRebuild first:\n  ${BUILD_HARNESS}`
    );
  }
}
```

- [x] Call `verifyHarnessBuild(harness)` in `locateHarness()` after existence validation and before
      source freshness validation.

- [x] Re-run the focused test and confirm it passes.

- [x] Run:

```powershell
npm run check
git diff --check
```

Expected: the complete merge gate and whitespace validation pass.

- [x] Commit:

```powershell
git add scripts/capture-rig.mjs scripts/capture-rig.test.mjs docs/superpowers/plans/2026-09-05-capture-harness-build-detection-fix.md
git commit -m "fix(capture): reject release builds without harness"
```
