# Transport Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the removed footer `status`/`status2` broadcast system with a single header transport notice for user-facing errors and guards.

**Architecture:** `useMeterDisplay` owns `notice`, `raiseNotice(kind, text)`, and `clearNotice()` in the same display layer that currently owns `status`/`status2`. Runtime and engine hooks clear the notice on new transport activity, raise only the spec-approved error/guard notices, and delete all redundant status writes. `AppHeader` renders the notice beside `SourceTransportCluster`; `FileAnalysisSummary` no longer renders a dedicated error banner.

**Tech Stack:** React 19 hooks/components, Vitest, Testing Library, existing Tailwind utility classes and PLVS display/runtime hooks.

---

## File Structure

- Modify: `src/hooks/useMeterDisplay.js` - replace status state with notice state and timer lifecycle.
- Modify: `src/hooks/useMeterDisplay.test.jsx` - cover initial notice, raising, clearing, and guard auto-dismiss.
- Modify: `src/runtime/MeterRuntimeContext.jsx` - remove redundant status writes; clear notices on transport actions; raise guard notices for invalid/concurrent file actions.
- Modify: `src/hooks/useCaptureTransport.js` - remove stop status writes and clear notice on explicit live stop.
- Modify: `src/hooks/useAudioEngine.js` - remove startup/success/device status writes; raise capture errors.
- Modify: `src/hooks/useFileAnalysisEngine.js` - remove progress/success status writes; raise file analysis errors.
- Modify: `src/hooks/useSourceTransportActions.js` - remove snapshot/return status writes.
- Modify: `src/hooks/useFileAnalysisReportExport.js` - replace invalid/export-failed status writes with notice guards/errors; drop export success confirmation.
- Modify: `src/App.jsx` - pass notice to header/export hooks/actions; remove history snapshot status effect and status props.
- Modify: `src/components/AppHeader.jsx` - render the transport notice slot immediately after `SourceTransportCluster`.
- Modify: `src/components/FileAnalysisSummary.jsx` - delete the `state === "error"` banner branch.
- Update tests: `src/hooks/useAudioEngine.test.js`, `src/hooks/useFileAnalysisEngine.test.jsx`, `src/hooks/useSourceTransportActions.test.jsx`, `src/hooks/useFileAnalysisReportExport.test.jsx`, `src/components/AppHeader.test.jsx`, `src/components/FileAnalysisSummary.test.jsx`, `src/App.smoke.test.jsx`, plus any tests that assert old `setStatus` props.

## Task 1: Display Notice Model

- [ ] **Step 1: Write failing notice lifecycle tests**

Add tests to `src/hooks/useMeterDisplay.test.jsx`:

```jsx
it("starts without a transport notice", () => {
  const { result } = renderHook(() => useMeterDisplay());
  expect(result.current.notice).toBeNull();
});

it("raises and clears a transport notice", () => {
  const { result } = renderHook(() => useMeterDisplay());
  act(() => result.current.raiseNotice("error", "Audio unavailable"));
  expect(result.current.notice).toEqual({ kind: "error", text: "Audio unavailable" });
  act(() => result.current.clearNotice());
  expect(result.current.notice).toBeNull();
});
```

Run: `npm test -- src/hooks/useMeterDisplay.test.jsx`
Expected: FAIL because `notice`, `raiseNotice`, and `clearNotice` do not exist yet.

- [ ] **Step 2: Implement minimal notice state**

In `src/hooks/useMeterDisplay.js`, remove `status`/`status2` state and return fields. Add:

```js
const [notice, setNotice] = useState(null);
const guardTimerRef = useRef(null);

const clearGuardTimer = () => {
  if (guardTimerRef.current) {
    clearTimeout(guardTimerRef.current);
    guardTimerRef.current = null;
  }
};

const clearNotice = () => {
  clearGuardTimer();
  setNotice(null);
};

const raiseNotice = (kind, text) => {
  clearGuardTimer();
  setNotice({ kind, text });
  if (kind === "guard") {
    guardTimerRef.current = setTimeout(() => {
      guardTimerRef.current = null;
      setNotice(null);
    }, 5000);
  }
};
```

Return `notice`, `raiseNotice`, and `clearNotice`.

- [ ] **Step 3: Verify display model**

Run: `npm test -- src/hooks/useMeterDisplay.test.jsx`
Expected: PASS.

## Task 2: Replace Status Writers

- [ ] **Step 1: Write failing hook tests for guard/error routing**

Update tests so old `setStatus` expectations become notice expectations:

```js
// src/hooks/useFileAnalysisReportExport.test.jsx
const raiseNotice = vi.fn();
useFileAnalysisReportExport({ fileSession: { state: "empty" }, appVersion: "0.7.3", raiseNotice });
expect(raiseNotice).toHaveBeenCalledWith("guard", "Choose a completed file analysis to export");
```

```js
// src/hooks/useAudioEngine.test.js
expect(props.raiseNotice).toHaveBeenCalledWith("error", "Error: Audio unavailable");
```

Run: `npm test -- src/hooks/useFileAnalysisReportExport.test.jsx src/hooks/useAudioEngine.test.js`
Expected: FAIL because production hooks still use `setStatus`.

- [ ] **Step 2: Update engine/export hook contracts**

Apply these production changes:

- `useAudioEngine`: destructure `raiseNotice`; delete `setStatus`/`setStatus2`; in catch call `raiseNotice("error", \`Error: ${err?.message || "Audio unavailable"}\`)`.
- `useFileAnalysisEngine`: destructure `raiseNotice`; delete progress/success status writes; non-Tauri branch raises `raiseNotice("error", "Error: File analysis runs in the desktop app")`; event/catch error paths raise `raiseNotice("error", \`Error: ${message}\`)`.
- `useFileAnalysisReportExport`: accept `raiseNotice`; invalid export raises guard, catch raises error, success does nothing.

- [ ] **Step 3: Update runtime and transport actions**

Apply these production changes:

- `MeterRuntimeContext`: replace concurrent/missing file guards with `display.raiseNotice("guard", ...)`; call `display.clearNotice()` on source switches, clear, begin/rerun/select/remove/clear file actions, and explicit file stop.
- `useCaptureTransport`: remove stop status writes and call `display.clearNotice?.()` when stopping live.
- `useSourceTransportActions`: remove `setStatus` prop and all calls that only restored derived transport labels.
- `App.jsx`: remove destructured `setStatus`/`setStatus2`, remove the history snapshot status effect, pass `raiseNotice` to export hook, pass `notice` to `AppHeader`, and stop passing `setStatus` into `historyData`.

- [ ] **Step 4: Verify hook/runtime tests**

Run: `npm test -- src/hooks/useAudioEngine.test.js src/hooks/useFileAnalysisEngine.test.jsx src/hooks/useFileAnalysisReportExport.test.jsx src/hooks/useSourceTransportActions.test.jsx src/runtime/MeterRuntimeContext.test.jsx`
Expected: PASS.

## Task 3: Header Notice And File Summary UI

- [ ] **Step 1: Write failing UI tests**

Add AppHeader tests:

```jsx
it("renders an error transport notice with tooltip text", () => {
  renderHeader({ notice: { kind: "error", text: "Error: Audio unavailable" } });
  const notice = screen.getByText("Error: Audio unavailable");
  expect(notice.title).toBe("Error: Audio unavailable");
  expect(notice.className).toContain("ui-signal-bad");
});

it("renders a guard transport notice", () => {
  renderHeader({ notice: { kind: "guard", text: "File analysis already in progress" } });
  expect(screen.getByText("File analysis already in progress")).toBeTruthy();
});
```

Update `FileAnalysisSummary.test.jsx` so `state: "error"` renders the normal summary shell with history menu and no `File analysis error`/error text banner.

Run: `npm test -- src/components/AppHeader.test.jsx src/components/FileAnalysisSummary.test.jsx`
Expected: FAIL until UI is updated.

- [ ] **Step 2: Render header notice**

In `src/components/AppHeader.jsx`, add `notice` prop and render after `SourceTransportCluster`:

```jsx
{notice ? (
  <div
    title={notice.text}
    className={cn(
      "min-w-0 max-w-[min(30rem,34vw)] truncate text-[length:var(--ui-fs-status)] font-medium",
      notice.kind === "error"
        ? "text-[color:var(--ui-signal-bad)]"
        : "text-muted-foreground"
    )}
  >
    {notice.text}
  </div>
) : null}
```

- [ ] **Step 3: Remove file error banner**

In `src/components/FileAnalysisSummary.jsx`, delete the `if (fileSession?.state === "error")` branch. The existing normal non-complete presentation handles error sessions by showing file metadata/name and history menu without metrics/export.

- [ ] **Step 4: Verify UI tests**

Run: `npm test -- src/components/AppHeader.test.jsx src/components/FileAnalysisSummary.test.jsx src/App.smoke.test.jsx`
Expected: PASS.

## Task 4: Remove Old Broadcast Surface

- [ ] **Step 1: Search for old status system remnants**

Run: `rg "setStatus|setStatus2|status2|status\\b" src -g "*.{js,jsx}"`
Expected: only unrelated uses remain, such as update/feedback local status, CSS token names, `StatusPill`, and file history status labels. No `useMeterDisplay` status fields or transport status setters remain.

- [ ] **Step 2: Fix any stale tests/props from the search**

If the search returns transport-era `setStatus`/`setStatus2` props, remove them and update assertions to `notice`/derived transport UI.

- [ ] **Step 3: Run focused verification**

Run: `npm test -- src/hooks/useMeterDisplay.test.jsx src/hooks/useAudioEngine.test.js src/hooks/useFileAnalysisEngine.test.jsx src/hooks/useFileAnalysisReportExport.test.jsx src/hooks/useSourceTransportActions.test.jsx src/runtime/MeterRuntimeContext.test.jsx src/components/AppHeader.test.jsx src/components/FileAnalysisSummary.test.jsx src/App.smoke.test.jsx`
Expected: PASS.

- [ ] **Step 4: Lint edited files**

Run IDE lints for edited files and fix any newly introduced diagnostics.

## Self-Review

- Spec coverage: notice data model/lifecycle, error/guard disposition, status broadcast removal, header placement, file error banner removal, and tests are all represented.
- Placeholder scan: no TODO/TBD placeholders.
- Branch safety: implementation must not start on `main` unless the user explicitly approves working there; prefer an isolated worktree if approved.
- Commit note: this plan intentionally does not include commit steps because the current user request did not explicitly ask for commits.
