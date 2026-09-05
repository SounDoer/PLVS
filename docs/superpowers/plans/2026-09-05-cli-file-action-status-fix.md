# CLI FILE Action Status Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report asynchronous FILE analysis actions as accepted rather than completed.

**Architecture:** Keep the existing Transport action response builder and choose its status from the
method. Only Analyze and Reanalyze use `accepted`; actions whose requested transition settles before
the response retain `completed`.

**Tech Stack:** React 19, Vitest, Testing Library

---

### Task 1: Distinguish accepted FILE analysis actions

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`

- [x] Add a parameterized bridge test for `transport.file.analyze` and
      `transport.file.reanalyze` that expects:

```js
expect(response.result).toMatchObject({
  action: method,
  status: "accepted",
});
```

- [x] Run:

```powershell
npm test -- --run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: both new cases fail because the bridge returns `completed`.

- [x] In the Transport action result, select the status without changing the surrounding response:

```js
status:
  request.method === "transport.file.analyze" ||
  request.method === "transport.file.reanalyze"
    ? "accepted"
    : "completed",
```

- [x] Re-run the focused bridge suite and confirm all tests pass.

- [x] Run:

```powershell
npm run check
git diff --check
```

Expected: the complete merge gate and whitespace validation pass.

- [x] Commit:

```powershell
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx docs/superpowers/plans/2026-09-05-cli-file-action-status-fix.md
git commit -m "fix(agent-control): report accepted file analysis"
```
