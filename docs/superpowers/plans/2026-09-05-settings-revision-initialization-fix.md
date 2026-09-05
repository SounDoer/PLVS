# Settings Revision Initialization Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep ordinary Settings revision tracking and command settlement operational when autostart or clear-shortcut hydration is unavailable.

**Architecture:** Split revision detection into an always-active ordinary-settings signature and two readiness-gated capability field trackers. Keep the existing complete Settings signature for command settlement.

**Tech Stack:** React 19, Vitest, Testing Library

---

### Task 1: Reproduce partial-capability Settings failures

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Add parameterized tests with either `autostartReady` or `clearShortcutReady` held false.
- [ ] Execute an unrelated `settings.update`, then assert success, revision `1`, final state, and one persistence flush.
- [ ] Start `app.wait` before the update and assert it returns `outcome: "changed"` at revision `1`.
- [ ] Run `npm test -- --run src/agentControl/useAgentControlBridge.test.jsx`.
- [ ] Confirm the new cases fail with `commitNotObserved` or a missing waiter response.

### Task 2: Split Settings revision initialization

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.js`

- [ ] Add an ordinary-settings signature that excludes `openAtLogin` and `clearShortcut`.
- [ ] Initialize ordinary tracking on mount.
- [ ] Track the first ready value of `openAtLogin` and `clearShortcut` as a no-revision baseline.
- [ ] Advance revision only for later changes to those capability-owned fields.
- [ ] Keep settlement comparison on the complete Settings signature.
- [ ] Run the focused bridge suite and confirm it passes.

### Task 3: Verify and commit

- [ ] Run `npm run check`.
- [ ] Run `git diff --check`.
- [ ] Review the final diff for unrelated changes.
- [ ] Commit with `fix(agent-control): decouple settings revision initialization`.
