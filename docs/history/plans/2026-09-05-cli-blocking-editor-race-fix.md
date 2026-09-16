# CLI Preset Blocking-Editor Race Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject Preset save, update, and apply when a blocking editor opens while asynchronous scene capture is pending.

**Architecture:** Preserve the existing early guard, then repeat the same guard after `captureSnapshot()` resolves and immediately before any Preset mutation. Add controlled deferred-promise tests that prove the late-opening editor is observed and no state or persistence mutation occurs.

**Tech Stack:** React 19, Vitest, Testing Library

---

### Task 1: Close the Preset scene-operation race

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`

- [ ] **Step 1: Add deferred race regression tests**

Add a local deferred-promise helper:

```js
function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
```

For each of `preset.save`, `preset.update`, and `preset.apply`, mount the bridge with:

```js
let editorOpen = false;
const snapshot = deferred();
const flush = vi.fn(async () => {});
const assertPresetOperationAllowed = vi.fn((operation) => {
  if (editorOpen) {
    throw new SceneOperationBlockedError(operation, ["theme"]);
  }
});
```

Start the request, wait until `capturePresetSnapshot` has been called, set `editorOpen = true`,
resolve the snapshot, and assert:

```js
expect(response.error).toMatchObject({
  code: -32040,
  data: {
    reason: "editorActive",
    details: { editors: ["theme"] },
  },
});
expect(flush).not.toHaveBeenCalled();
```

Also compare `preset.list` and Workspace state before and after each request so the test proves the
refusal occurs before mutation.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- --run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: the three new race cases fail because the operation succeeds after the first guard.

- [ ] **Step 3: Add the final pre-mutation guard**

In the shared `preset.save` / `preset.update` branch, after:

```js
const snapshot = await presets.captureSnapshot();
assertRevisions();
```

add:

```js
presets.assertSceneOperationAllowed(request.method);
```

In the `preset.apply` branch, after:

```js
const currentSnapshot = await presets.captureSnapshot();
assertRevisions();
```

add:

```js
presets.assertSceneOperationAllowed(request.method);
```

These checks must remain before planning and before `saveSnapshot`, `updateSnapshot`,
`activateSnapshot`, or `applySnapshot`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- --run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: all bridge tests pass.

- [ ] **Step 5: Run the complete merge gate**

Run:

```powershell
npm run check
git diff --check
git status --short
```

Expected: all checks pass; only the approved design, this plan, bridge test, and bridge
implementation are changed.

- [ ] **Step 6: Commit the fix**

```powershell
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx docs/superpowers/plans/2026-09-05-cli-blocking-editor-race-fix.md
git commit -m "fix(agent-control): recheck blocking editors before preset commit"
```
