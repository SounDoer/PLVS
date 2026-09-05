# CLI Revision Batch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one global revision and one waiter wake-up for all state commits belonging to one CLI mutation or action.

**Architecture:** Wrap requests carrying `expectedRevision` in a short-lived in-memory revision batch. Let the first state effect increment revision, coalesce later effects, and defer waiter notification until a `finally` block closes the batch.

**Tech Stack:** React 19, Vitest, Testing Library

---

### Task 1: Reproduce split-commit revision publication

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Extend the test Harness with an opt-in stagger between Preset Workspace replacement and
  Preset activation.
- [ ] Start `app.wait` at revision `0`, then apply a Preset that changes both states.
- [ ] Assert the command and waiter both report revision `1`.
- [ ] Run `npm test -- --run src/agentControl/useAgentControlBridge.test.jsx`.
- [ ] Confirm the test fails because the command reaches revision `2` or the waiter wakes at an
  intermediate revision.

### Task 2: Batch revision publication

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.js`

- [ ] Add a ref containing `bumped` and `wakePending` for the active command.
- [ ] In `bumpControlRevision`, increment only on the first change in an active batch.
- [ ] In `scheduleWaitWake`, record a deferred wake instead of publishing while a batch is active.
- [ ] Start a batch for requests with `expectedRevision`.
- [ ] Close it in `finally` and publish any deferred wake.
- [ ] Re-run the focused bridge test and confirm it passes.

### Task 3: Verify batch cleanup

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Exercise a mutation that commits and then reports a failure.
- [ ] Execute another mutation and assert it advances revision independently.
- [ ] Run the focused bridge suite.

### Task 4: Verify and commit

- [ ] Run `npm run check`.
- [ ] Run `git diff --check`.
- [ ] Review the diff for unrelated changes.
- [ ] Commit with `fix(agent-control): batch command revision publication`.
