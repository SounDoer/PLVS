# Soak Capture Completion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent abnormal or incomplete capture subprocess runs from producing a green soak result.

**Architecture:** Put the subprocess completion contract in a pure helper in the existing shared
capture rig and call it before computing drift.

**Tech Stack:** Node.js, Vitest

---

### Task 1: Validate capture completion

**Files:**

- Modify: `scripts/capture-rig.mjs`
- Modify: `scripts/capture-rig.test.mjs`
- Modify: `scripts/soak-capture.mjs`

- [ ] Write tests for `assertSoakCaptureCompleted(status, finalReport)`:

```js
expect(() => assertSoakCaptureCompleted(0, { status: "ok" })).not.toThrow();
expect(() => assertSoakCaptureCompleted(1, null)).toThrow(/exit code 1/);
expect(() => assertSoakCaptureCompleted(0, null)).toThrow(/without a final report/);
expect(() =>
  assertSoakCaptureCompleted(0, { status: "error", error: { message: "device lost" } }),
).toThrow(/device lost/);
```

- [ ] Run `npm test -- --run scripts/capture-rig.test.mjs`.

Expected: FAIL because the helper export does not exist.

- [ ] Implement the helper with strict exit-zero, report-presence, and report-status checks.
- [ ] Replace the two conditional checks in `soak-capture.mjs` with one helper call before sample
      evaluation.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Run `npm run check` and `git diff --check`.
- [ ] Commit with `fix(capture): require complete soak report`.
