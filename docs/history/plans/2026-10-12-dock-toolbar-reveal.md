# Dock Toolbar Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hover-triggered Dock header with a toolbar the user opens from a persistent
entry on the strip, restyled after the normal window header at Dock's fixed density.

**Architecture:** `useDockAccessoryVisibility` stops inferring intent from pointer presence and
holds one explicit `toolbarOpen` flag; `headerVisible` is derived from it, the open editor and the
error notice. Each Dock WebView reports its own window focus, and the hook closes the toolbar once
no Dock window has had focus for a short grace period. The accessory pointer channel becomes a
focus channel; the cursor poll and its Rust command are deleted.

**Tech Stack:** React 19 hooks, plain ES modules with JSDoc types checked by `tsc` (checkJs),
Vitest (jsdom for React tests), Tailwind classes, Tauri 2 / Rust for the accessory windows.

**Spec:** `docs/history/specs/2026-10-12-dock-toolbar-reveal-design.md`

## Global Constraints

- Work happens in the worktree `.claude/worktrees/dock-toolbar-reveal` on branch
  `worktree-dock-toolbar-reveal`. Never edit `src/` while the dev app is running.
- Pointer enter/leave never changes what is on screen.
- The toolbar is shown when any of: the user opened it, an editor is open, the notice is an error.
- Header window height is `36` logical px; the entry column is `20` CSS px wide.
- Tips are Title Case: `Show Toolbar` / `Hide Toolbar`. `aria-label`s are lowercase.
- The entry is sized in fixed px / `--ui-dock-*` tokens, never `--ui-shell-h`.
- The toolbar's open state is not persisted. Entering Dock starts closed.
- No new toolbar actions, no Agent Control command, no global shortcut, no tray item.
- All engine/IPC traffic stays in `src/ipc/`. Never hand-edit `src/generated/` or
  `docs/agent-control/generated/`.
- Commits follow Conventional Commits with the `dock` scope. Before every commit: `npm test`, plus
  `npm run format:check`, `npm run lint`, `npm run typecheck` for frontend changes and
  `npm run rust:check` for Rust changes. End every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass the message with several `-m`
  flags; do not use a here-string and do not start the subject with `@`.
- Tests that render React or touch persistence start with `/** @vitest-environment jsdom */`.
  jest-dom matchers are not available: assert with `getAttribute`, `textContent`, `toBeNull`.

## Review Focus

1. **Closing a focused editor.** The user presses Escape inside an editor. The editor window is
   hidden while it holds focus, the OS hands focus to whatever is behind PLVS, and the toolbar would
   close under the user although the spec says a second Escape closes it. Task 5 refocuses the
   header in Rust; no unit test can see it, so it is checked by hand in Task 6.
2. **A window that never reports blur.** If a hidden accessory keeps a stale "focused" flag, the
   toolbar would never close on focus loss again. Pinned by a hook test in Task 1.
3. **The error-forced header.** With an error notice the header must survive the entry, Escape and
   focus loss, and the entry must read as pressed. Pinned by hook tests in Task 1 and a strip test in
   Task 3.
4. **An editor opened without the toolbar.** Agent Control's panel-settings navigation opens a Dock
   editor directly. The header must come with it and leave with it, without leaving `toolbarOpen`
   set. Pinned by a hook test in Task 1.
5. **Full-screen yield on Windows with the toolbar open.** A window going full screen on the Dock's
   monitor takes the foreground, so the focus rule should close the toolbar. That is an inference;
   it is checked by hand in Task 6, with the fallback named there.

---

### Task 0: Baseline screenshots of the current behaviour

Captured before any code changes, so Task 6 has a "before" to compare against.

**Files:**

- Create (untracked, ignored): `artifacts/ui-review/dock-toolbar/before/`

- [ ] **Step 1: Fetch the sidecar a fresh worktree needs**

Run: `npm run ffmpeg:fetch`
Expected: exits 0.

- [ ] **Step 2: Cold-start the dev app from this worktree**

Make sure no PLVS Dev process is running (find it by PID; never `taskkill //IM plvs.exe`, which
also kills the installed app). Then run `npm run desktop:dev` in the background and wait for the
window. The first build takes several minutes.

- [ ] **Step 3: Enter Dock and capture the strip**

```bash
npm run desktop:control -- inspect --json
```

Note the revision, enter Dock on the bottom edge with the View Control patch described in
`docs/agent-control/view.md`, then:

```bash
npm run desktop:control -- visual screenshot --target main --out artifacts/ui-review/dock-toolbar/before/strip.png --json
```

Right after a cold start the first call can return `frontendNotReady`; retry after a few seconds.

- [ ] **Step 4: Capture the header**

Move the real pointer onto the strip so the header shows, then:

```bash
npm run desktop:control -- visual screenshot --target dock-header --out artifacts/ui-review/dock-toolbar/before/header.png --json
```

Expected: a PNG whose height is 44 × the display scale.

- [ ] **Step 5: Stop the dev app by PID.** Nothing to commit.

---

### Task 1: Explicit toolbar state in `useDockAccessoryVisibility`

**Files:**

- Modify: `src/dock/accessoryVisibility.js`
- Modify: `src/dock/accessoryVisibility.test.js`
- Modify: `src/dock/useDockAccessoryVisibility.js`
- Modify: `src/dock/useDockAccessoryVisibility.test.jsx`
- Modify: `src/App.jsx:601-602` (drop two props)
- Modify: `src/dock/DockAccessoriesContext.jsx:316` (drop one argument)

**Interfaces:**

- Produces, from `shouldShowDockHeader({ userOpen, editorOpen, forceVisible })`: `boolean`.
- Produces, from `useDockAccessoryVisibility(...)`:
  - `headerVisible: boolean`, `editorView`, `editorVisible`, `editorSize`, `openEditor`,
    `closeEditor`, `resizeEditor` (unchanged meaning)
  - `toggleToolbar(): void` — the entry's click handler
  - `dismiss(): void` — Escape: closes the open editor, otherwise the toolbar
  - `onAccessoryFocus({ surface: "dock-header" | "dock-editor", focused: boolean }): void`
- Removes `onStripPointerEnter`, `onStripPointerLeave`, `onAccessoryPointer`.

After this task nothing opens the toolbar from the UI yet; the entry arrives in Task 3.

- [ ] **Step 1: Rewrite the pure predicate's test**

Replace the body of `src/dock/accessoryVisibility.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { shouldShowDockHeader } from "./accessoryVisibility.js";

describe("dock accessory visibility", () => {
  it.each([
    [{ userOpen: true, editorOpen: false }, true],
    [{ userOpen: false, editorOpen: true }, true],
    [{ userOpen: false, editorOpen: false, forceVisible: true }, true],
    [{ userOpen: false, editorOpen: false }, false],
  ])("shows the header only on request, for an editor, or for an error", (input, expected) => {
    expect(shouldShowDockHeader(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Rewrite the hook's hover tests**

In `src/dock/useDockAccessoryVisibility.test.jsx`:

Change the imports and the mock at the top to:

```js
/** @vitest-environment jsdom */
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockAccessories } from "../ipc/commands.js";
import {
  createLatestDockAccessoryUpdater,
  setDockAccessoriesWhenReady,
  useDockAccessoryVisibility,
} from "./useDockAccessoryVisibility.js";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({
  setDockAccessories: vi.fn().mockResolvedValue(undefined),
}));

function renderVisibility(initialProps = {}) {
  return renderHook(
    (props) =>
      useDockAccessoryVisibility({
        active: true,
        edge: "bottom",
        geometryVersion: undefined,
        onError: undefined,
        ...props,
      }),
    { initialProps }
  );
}

const blurStrip = () => act(() => void window.dispatchEvent(new Event("blur")));
const focusStrip = () => act(() => void window.dispatchEvent(new Event("focus")));
```

Change `beforeEach` to only `vi.useFakeTimers();`.

Delete these seven tests, which describe behaviour that no longer exists:

- `shows on strip enter and hides immediately after both surfaces are left`
- `repairs a missed pointer leave from live native window geometry`
- `repairs a missed re-enter after native geometry hid the header`
- `does not fight reliable DOM enter and leave events when native geometry agrees`
- `does not let a stale cursor result overwrite a newer pointer enter`
- `does not reconcile hover while an editor or forced error keeps the header open`
- `stops reconciliation across preset-style Dock exit and restarts with live geometry`

Leave every other existing test as it is. Add these inside the `describe`:

```js
it("stays closed until the entry is toggled, and publishes the change", async () => {
  const { result } = renderVisibility();
  expect(result.current.headerVisible).toBe(false);

  act(() => result.current.toggleToolbar());
  expect(result.current.headerVisible).toBe(true);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(setDockAccessories).toHaveBeenLastCalledWith(
    expect.objectContaining({ headerVisible: true })
  );

  act(() => result.current.toggleToolbar());
  expect(result.current.headerVisible).toBe(false);
});

it("closes the editor and the toolbar together when the entry is toggled", () => {
  const { result } = renderVisibility();
  act(() => result.current.toggleToolbar());
  act(() => result.current.openEditor("modules"));

  act(() => result.current.toggleToolbar());

  expect(result.current.editorView).toBeNull();
  expect(result.current.headerVisible).toBe(false);
});

it("closes the editor on the first Escape and the toolbar on the second", () => {
  const { result } = renderVisibility();
  act(() => result.current.toggleToolbar());
  act(() => result.current.openEditor("modules"));

  fireEvent.keyDown(window, { key: "Escape" });
  expect(result.current.editorView).toBeNull();
  expect(result.current.headerVisible).toBe(true);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(result.current.headerVisible).toBe(false);
});

it("closes once focus has left every Dock window for the grace period", () => {
  const { result } = renderVisibility();
  act(() => result.current.toggleToolbar());

  blurStrip();
  act(() => vi.advanceTimersByTime(149));
  expect(result.current.headerVisible).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.headerVisible).toBe(false);
});

it("stays open while focus moves between Dock windows", () => {
  const { result } = renderVisibility();
  act(() => result.current.toggleToolbar());

  blurStrip();
  act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: true }));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.headerVisible).toBe(true);

  act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: false }));
  focusStrip();
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.headerVisible).toBe(true);

  blurStrip();
  act(() => vi.advanceTimersByTime(150));
  expect(result.current.headerVisible).toBe(false);
});

it("forgets an accessory's focus once the toolbar has closed", () => {
  const { result } = renderVisibility();
  act(() => result.current.toggleToolbar());
  // The header is hidden while it still claims focus and never reports the blur.
  act(() => result.current.onAccessoryFocus({ surface: "dock-header", focused: true }));
  act(() => result.current.toggleToolbar());

  act(() => result.current.toggleToolbar());
  blurStrip();
  act(() => vi.advanceTimersByTime(150));

  expect(result.current.headerVisible).toBe(false);
});

it("cannot be dismissed while an error requires attention", () => {
  const { result, rerender } = renderVisibility({ forceHeaderVisible: true });
  expect(result.current.headerVisible).toBe(true);

  act(() => result.current.dismiss());
  blurStrip();
  act(() => vi.advanceTimersByTime(150));
  expect(result.current.headerVisible).toBe(true);

  rerender({ forceHeaderVisible: false });
  expect(result.current.headerVisible).toBe(false);
});

it("shows the header for an editor opened without the toolbar and hides it afterwards", () => {
  const { result } = renderVisibility();
  act(() => result.current.openEditor("module:spectrogram"));
  expect(result.current.headerVisible).toBe(true);

  act(() => result.current.closeEditor());
  expect(result.current.headerVisible).toBe(false);
});

it("starts closed again after Dock was inactive", () => {
  const { result, rerender } = renderVisibility();
  act(() => result.current.toggleToolbar());

  rerender({ active: false });
  expect(result.current.headerVisible).toBe(false);
  act(() => vi.advanceTimersByTime(0));
  rerender({ active: true });

  expect(result.current.headerVisible).toBe(false);
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run src/dock/accessoryVisibility.test.js src/dock/useDockAccessoryVisibility.test.jsx`
Expected: FAIL — `result.current.toggleToolbar is not a function`, and the predicate test fails on
the `userOpen` rows.

- [ ] **Step 4: Replace the predicate**

`src/dock/accessoryVisibility.js` becomes:

```js
export function shouldShowDockHeader({ userOpen, editorOpen, forceVisible = false }) {
  return userOpen || editorOpen || forceVisible;
}
```

- [ ] **Step 5: Rewrite the hook's visibility half**

In `src/dock/useDockAccessoryVisibility.js`:

Change the import line and the constants at the top:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { setDockAccessories } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { shouldShowDockHeader } from "./accessoryVisibility.js";

const ACCESSORY_READY_RETRY_MS = 50;
const ACCESSORY_READY_ATTEMPTS = 4;
// Focus hops between the strip, the header and the editor pass through a moment where none of
// them has it. Longer than the editor's own 100 ms blur delay, so the editor settles first.
const TOOLBAR_FOCUS_GRACE_MS = 150;
```

`initialEditorSize`, `isAccessoryUnavailable`, `setDockAccessoriesWhenReady` and
`createLatestDockAccessoryUpdater` do not change.

Replace the whole `useDockAccessoryVisibility` function with:

```js
/**
 * @param {{
 *   active: boolean,
 *   edge: string,
 *   geometryVersion: number,
 *   forceHeaderVisible?: boolean,
 *   onError: (...args: any[]) => any,
 * }} options
 */
export function useDockAccessoryVisibility({
  active,
  edge,
  geometryVersion,
  forceHeaderVisible = false,
  onError,
}) {
  const [toolbarOpen, setToolbarOpenState] = useState(false);
  const [editorView, setEditorView] = useState(null);
  const [editorSize, setEditorSize] = useState(() => initialEditorSize(null));
  const [editorAnchorX, setEditorAnchorX] = useState(null);
  const [measuredEditorView, setMeasuredEditorView] = useState(null);
  const toolbarOpenRef = useRef(false);
  const editorViewRef = useRef(null);
  const measuredEditorViewRef = useRef(null);
  const focusRef = useRef({ strip: false, "dock-header": false, "dock-editor": false });
  const focusTimerRef = useRef(null);
  const accessoryUpdaterRef = useRef(null);
  if (accessoryUpdaterRef.current === null) {
    accessoryUpdaterRef.current = createLatestDockAccessoryUpdater();
  }

  const headerVisible =
    active &&
    shouldShowDockHeader({
      userOpen: toolbarOpen,
      editorOpen: editorView !== null,
      forceVisible: forceHeaderVisible,
    });

  const setToolbarOpen = useCallback((open) => {
    toolbarOpenRef.current = open;
    setToolbarOpenState(open);
  }, []);

  const openEditor = useCallback((view, anchorX) => {
    const hasVisibleEditor =
      editorViewRef.current !== null && measuredEditorViewRef.current === editorViewRef.current;
    if (!hasVisibleEditor) {
      setEditorSize(initialEditorSize(view));
      measuredEditorViewRef.current = null;
      setMeasuredEditorView(null);
    }
    editorViewRef.current = view;
    if (Number.isFinite(anchorX)) setEditorAnchorX(anchorX);
    setEditorView(view);
  }, []);
  const closeEditor = useCallback((expectedView, reason) => {
    if (expectedView && editorViewRef.current !== expectedView) return;
    if (reason === "blur" && measuredEditorViewRef.current !== editorViewRef.current) return;
    editorViewRef.current = null;
    measuredEditorViewRef.current = null;
    setMeasuredEditorView(null);
    setEditorView(null);
  }, []);
  const resizeEditor = useCallback(({ view, width, height }) => {
    if (!view || editorViewRef.current !== view) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const next = {
      width: Math.max(176, Math.min(400, Math.ceil(width))),
      height: Math.max(80, Math.min(640, Math.ceil(height))),
    };
    setEditorSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
    measuredEditorViewRef.current = view;
    setMeasuredEditorView(view);
  }, []);

  const toggleToolbar = useCallback(() => {
    if (toolbarOpenRef.current || editorViewRef.current !== null) {
      closeEditor();
      setToolbarOpen(false);
    } else {
      setToolbarOpen(true);
    }
  }, [closeEditor, setToolbarOpen]);
  const dismiss = useCallback(() => {
    if (editorViewRef.current !== null) closeEditor();
    else setToolbarOpen(false);
  }, [closeEditor, setToolbarOpen]);

  const reportFocus = useCallback(
    (surface, focused) => {
      if (!(surface in focusRef.current)) return;
      focusRef.current[surface] = focused;
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
      if (Object.values(focusRef.current).some(Boolean)) return;
      focusTimerRef.current = setTimeout(() => {
        focusTimerRef.current = null;
        setToolbarOpen(false);
      }, TOOLBAR_FOCUS_GRACE_MS);
    },
    [setToolbarOpen]
  );
  const onAccessoryFocus = useCallback(
    ({ surface, focused }) => reportFocus(surface, focused),
    [reportFocus]
  );

  useEffect(() => {
    if (active) return;
    const resetTimer = setTimeout(() => {
      editorViewRef.current = null;
      measuredEditorViewRef.current = null;
      setMeasuredEditorView(null);
      setEditorView(null);
      setEditorAnchorX(null);
      setToolbarOpen(false);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [active, setToolbarOpen]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => reportFocus("strip", true);
    const onBlur = () => reportFocus("strip", false);
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [active, dismiss, reportFocus]);

  useEffect(() => {
    if (headerVisible) return;
    // A window hidden while it holds focus may never report the blur.
    focusRef.current["dock-header"] = false;
    focusRef.current["dock-editor"] = false;
  }, [headerVisible]);

  useEffect(() => {
    if (!isTauri()) return;
    accessoryUpdaterRef.current.update(
      {
        edge,
        headerVisible,
        editorVisible: active && editorView !== null && measuredEditorView !== null,
        editorWidth: editorSize.width,
        editorHeight: editorSize.height,
        editorAnchorX,
      },
      onError
    );
  }, [
    active,
    edge,
    editorSize,
    editorAnchorX,
    editorView,
    geometryVersion,
    headerVisible,
    measuredEditorView,
    onError,
  ]);

  return {
    headerVisible,
    editorView,
    editorVisible: editorView !== null && measuredEditorView === editorView,
    editorSize,
    toggleToolbar,
    dismiss,
    onAccessoryFocus,
    openEditor,
    closeEditor,
    resizeEditor,
  };
}
```

- [ ] **Step 6: Update the two callers**

In `src/App.jsx`, delete these two lines from `dockProps`:

```js
        onPointerEnter: dockAccessoryVisibility.onStripPointerEnter,
        onPointerLeave: dockAccessoryVisibility.onStripPointerLeave,
```

In `src/dock/DockAccessoriesContext.jsx`, delete this line from the `useDockAccessoryBridge` call:

```js
    onPointer: dockAccessoryVisibility.onAccessoryPointer,
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/dock/accessoryVisibility.test.js src/dock/useDockAccessoryVisibility.test.jsx`
Expected: PASS. If `settles while inactive instead of rescheduling its own reset` fails, the reset
effect's dependency list has grown beyond `[active, setToolbarOpen]`; restore it.

- [ ] **Step 8: Run the commit checks and commit**

Run: `npm test && npm run format:check && npm run lint && npm run typecheck`
Expected: all green.

```bash
git add src/dock/accessoryVisibility.js src/dock/accessoryVisibility.test.js src/dock/useDockAccessoryVisibility.js src/dock/useDockAccessoryVisibility.test.jsx src/App.jsx src/dock/DockAccessoriesContext.jsx
git commit -m "refactor(dock): hold the toolbar open state explicitly" -m "Header visibility is derived from an explicit flag, the open editor and the error notice. Pointer presence and the cursor poll no longer feed it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Accessory focus channel and Escape in the header

**Files:**

- Modify: `src/dock/accessoryProtocol.js`
- Modify: `src/dock/accessoryProtocol.test.js`
- Modify: `src/ipc/dockAccessoryEvents.js`
- Modify: `src/dock/accessories/useAccessoryClient.js`
- Modify: `src/dock/accessories/useAccessoryClient.test.jsx`
- Modify: `src/dock/accessories/DockHeaderApp.jsx`
- Create: `src/dock/accessories/DockHeaderApp.test.jsx`
- Modify: `src/dock/accessories/DockHeader.jsx` (drop `onPointer`)
- Modify: `src/dock/accessories/DockHeader.test.jsx`
- Modify: `src/dock/accessories/DockEditorApp.jsx` (drop `pointer`)
- Modify: `src/dock/accessories/DockEditorApp.test.jsx`
- Modify: `src/dock/useDockAccessoryBridge.js`
- Modify: `src/dock/DockAccessoriesContext.jsx`

**Interfaces:**

- Consumes: `onAccessoryFocus({ surface, focused })` and `dismiss()` from Task 1.
- Produces:
  - `DOCK_ACCESSORY_EVENTS.focus === "dock-accessory://focus"` (replaces `.pointer`)
  - `normalizeAccessoryFocus(raw): { surface, focused } | null` (replaces `normalizeAccessoryPointer`)
  - `listenDockAccessoryFocus(handler)`, `emitDockAccessoryFocus({ surface, focused })`
  - `useAccessoryClient(surface)` returns `{ payload, action }` and reports focus by itself
  - accessory action type `"dismiss-toolbar"`
  - `useDockAccessoryBridge({ active, headerState, editorState, onAction, onFocus })`
  - `DockHeader({ state, onAction })`

- [ ] **Step 1: Write the failing protocol test**

In `src/dock/accessoryProtocol.test.js`, change the import `normalizeAccessoryPointer` to
`normalizeAccessoryFocus`, rename the test to
`"normalizes known semantic actions and focus messages"`, and replace its last assertion with:

```js
expect(normalizeAccessoryAction({ surface: "dock-header", type: "dismiss-toolbar" })).toMatchObject(
  { type: "dismiss-toolbar" }
);
expect(normalizeAccessoryFocus({ surface: "dock-editor", focused: true })).toEqual({
  surface: "dock-editor",
  focused: true,
});
expect(normalizeAccessoryFocus({ surface: "main", focused: true })).toBeNull();
expect(normalizeAccessoryFocus({ surface: "dock-editor", focused: "yes" })).toBeNull();
```

- [ ] **Step 2: Write the failing client test**

In `src/dock/accessories/useAccessoryClient.test.jsx`, change the hoisted mocks and the module mock
to:

```js
const mocks = vi.hoisted(() => ({
  emitReady: vi.fn(async () => {}),
  emitFocus: vi.fn(async () => {}),
  listenState: vi.fn(),
}));

vi.mock("../../ipc/dockAccessoryEvents.js", () => ({
  emitDockAccessoryAction: vi.fn(async () => {}),
  emitDockAccessoryFocus: mocks.emitFocus,
  emitDockAccessoryReady: mocks.emitReady,
  listenDockAccessoryState: mocks.listenState,
}));
```

Add `mocks.emitFocus.mockClear();` to `beforeEach`, and add this test:

```js
it("reports its own window focus to the main window", () => {
  mocks.listenState.mockResolvedValue(() => {});
  const { unmount } = renderHook(() => useAccessoryClient("dock-header"));

  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
  });
  unmount();
  act(() => void window.dispatchEvent(new Event("focus")));

  expect(mocks.emitFocus.mock.calls).toEqual([
    [{ surface: "dock-header", focused: true }],
    [{ surface: "dock-header", focused: false }],
  ]);
});
```

- [ ] **Step 3: Write the failing header tests**

Create `src/dock/accessories/DockHeaderApp.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockHeaderApp } from "./DockHeaderApp.jsx";

const { client } = vi.hoisted(() => ({ client: { payload: null, action: vi.fn() } }));

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockHeaderApp", () => {
  it("asks the main window to dismiss on Escape", () => {
    const { unmount } = render(<DockHeaderApp />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(client.action.mock.calls).toEqual([["dismiss-toolbar"]]);
  });
});
```

In `src/dock/accessories/DockHeader.test.jsx`, remove every `onPointer={...}` prop, and replace the
test `emits semantic actions and pointer presence` with:

```jsx
it("emits semantic actions and ignores pointer presence", () => {
  const onAction = vi.fn();
  render(<DockHeader state={STATE} onAction={onAction} />);
  fireEvent.pointerEnter(screen.getByTestId("dock-header"));
  const modulesButton = screen.getByRole("button", { name: "Edit modules" });
  vi.spyOn(modulesButton, "getBoundingClientRect").mockReturnValue(
    /** @type {ReturnType<typeof modulesButton.getBoundingClientRect>} */ ({
      left: 320,
      width: 24,
    })
  );
  fireEvent.click(modulesButton);
  fireEvent.pointerLeave(screen.getByTestId("dock-header"));
  expect(onAction.mock.calls).toEqual([["open-editor", { view: "modules", anchorX: 332 }]]);
});
```

In `src/dock/accessories/DockEditorApp.test.jsx`, delete the `pointer: vi.fn(),` line from the
hoisted `client`.

- [ ] **Step 4: Run the tests and watch them fail**

Run: `npx vitest run src/dock/accessoryProtocol.test.js src/dock/accessories`
Expected: FAIL — `normalizeAccessoryFocus` is not exported, `emitFocus` is never called, and
`dismiss-toolbar` is never sent.

- [ ] **Step 5: Change the protocol**

In `src/dock/accessoryProtocol.js`:

```js
export const DOCK_ACCESSORY_EVENTS = Object.freeze({
  state: "dock-accessory://state",
  action: "dock-accessory://action",
  focus: "dock-accessory://focus",
  ready: "dock-accessory://ready",
});
```

Add `"dismiss-toolbar",` to `ACTION_TYPES` directly after `"close-editor",`.

Replace `normalizeAccessoryPointer` with:

```js
export function normalizeAccessoryFocus(raw) {
  if (!raw || !isDockAccessorySurface(raw.surface) || typeof raw.focused !== "boolean") {
    return null;
  }
  return { surface: raw.surface, focused: raw.focused };
}
```

In `src/ipc/dockAccessoryEvents.js`, replace `listenDockAccessoryPointer` and
`emitDockAccessoryPointer` with:

```js
export function listenDockAccessoryFocus(handler) {
  return listen(DOCK_ACCESSORY_EVENTS.focus, (event) => handler(event.payload));
}
```

```js
export function emitDockAccessoryFocus(focus) {
  return emitTo("main", DOCK_ACCESSORY_EVENTS.focus, focus);
}
```

- [ ] **Step 6: Report focus from the accessory client**

In `src/dock/accessories/useAccessoryClient.js`, import `emitDockAccessoryFocus` instead of
`emitDockAccessoryPointer`, delete the `pointer` callback, add this effect after the state-listener
effect, and return `{ payload, action }`:

```js
useEffect(() => {
  const onFocus = () => void emitDockAccessoryFocus({ surface, focused: true });
  const onBlur = () => void emitDockAccessoryFocus({ surface, focused: false });
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
}, [surface]);
```

- [ ] **Step 7: Update the accessory roots**

`src/dock/accessories/DockHeaderApp.jsx` becomes:

```jsx
import { useEffect } from "react";
import { DockHeader } from "./DockHeader.jsx";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";

export function DockHeaderApp() {
  const { payload, action } = useAccessoryClient("dock-header");
  useSuppressNativeContextMenu();

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") action("dismiss-toolbar");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action]);

  return <DockHeader state={payload} onAction={action} />;
}
```

In `src/dock/accessories/DockHeader.jsx`: change the JSDoc and signature to
`/** @param {{ state: any, onAction: (...args: any[]) => any }} props */` and
`export function DockHeader({ state, onAction }) {`, and delete the `onPointerEnter` and
`onPointerLeave` props from the root `div`.

In `src/dock/accessories/DockEditorApp.jsx`: change the destructuring to
`const { payload, action } = useAccessoryClient("dock-editor");` and delete the `onPointerEnter` and
`onPointerLeave` props from the root `div` (`data-testid="dock-editor"`).

- [ ] **Step 8: Rewire the bridge and the provider**

In `src/dock/useDockAccessoryBridge.js`: import `listenDockAccessoryFocus` and
`normalizeAccessoryFocus` in place of the pointer names; rename the option and its ref
(`onPointer` → `onFocus`, `onPointerRef` → `onFocusRef`) everywhere in the file; and replace the
pointer listener with:

```js
      listenDockAccessoryFocus((raw) => {
        const focus = normalizeAccessoryFocus(raw);
        if (focus) onFocusRef.current?.(focus);
      }),
```

In `src/dock/DockAccessoriesContext.jsx`, add to the `useDockAccessoryBridge` call:

```js
    onFocus: dockAccessoryVisibility.onAccessoryFocus,
```

and add this branch to `onDockAccessoryAction`, directly after the `close-editor` branch:

```js
      } else if (type === "dismiss-toolbar") {
        setHoveredDockPanelId(null);
        dockAccessoryVisibility.dismiss();
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/dock src/ipc`
Expected: PASS.

- [ ] **Step 10: Run the commit checks and commit**

Run: `npm test && npm run format:check && npm run lint && npm run typecheck`
Expected: all green.

```bash
git add src/dock src/ipc/dockAccessoryEvents.js
git commit -m "refactor(dock): report accessory focus instead of pointer presence" -m "Each accessory WebView tells the main window when its own window gains or loses focus, and the header forwards Escape as a dismiss action." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The entry on the strip

**Files:**

- Create: `src/dock/DockToolbarToggle.jsx`
- Modify: `src/dock/DockStrip.jsx`
- Modify: `src/dock/DockStrip.test.jsx`
- Modify: `src/dock/dockTokens.css`
- Modify: `src/components/RecordingIndicator.jsx`
- Modify: `src/App.jsx` (`dockProps`)
- Modify: `docs/user/workspace.md` (Dock section)

**Interfaces:**

- Consumes: `headerVisible`, `toggleToolbar` from Task 1.
- Produces:
  - `DockToolbarToggle({ edge: string, open: boolean, onToggle: () => void })`
  - `DockStrip` props `toolbarOpen?: boolean`, `onToolbarToggle?: () => void`; removes
    `onPointerEnter`, `onPointerLeave`
  - CSS variable `--ui-dock-toolbar-toggle-w: 20px` on `.dock-strip`
  - `RecordingIndicator({ state, className? })`

- [ ] **Step 1: Write the failing strip tests**

In `src/dock/DockStrip.test.jsx`:

Add `within` to the `@testing-library/react` import. Delete `onPointerEnter` and `onPointerLeave`
from `BASE_PROPS`.

Replace the test `reports pointer presence without rendering accessory controls in the strip` with:

```jsx
it("offers the toolbar entry and no accessory controls", () => {
  const onToolbarToggle = vi.fn();
  renderStrip({ onToolbarToggle });

  const entry = screen.getByRole("button", { name: "show toolbar" });
  expect(entry.getAttribute("aria-pressed")).toBe("false");
  fireEvent.pointerEnter(screen.getByTestId("dock-strip"));
  fireEvent.pointerLeave(screen.getByTestId("dock-strip"));
  expect(onToolbarToggle).not.toHaveBeenCalled();

  fireEvent.click(entry);
  expect(onToolbarToggle).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: /restore window/i })).toBeNull();
});

it("marks the entry pressed while the toolbar is shown", () => {
  renderStrip({ toolbarOpen: true });

  const entry = screen.getByRole("button", { name: "hide toolbar" });
  expect(entry.getAttribute("aria-pressed")).toBe("true");
});

it.each([
  ["bottom", false, "up"],
  ["bottom", true, "down"],
  ["top", false, "down"],
  ["top", true, "up"],
])("points the entry chevron for edge %s, open %s: %s", (edge, toolbarOpen, direction) => {
  renderStrip({ edge, toolbarOpen });

  expect(screen.getByTestId("dock-toolbar-toggle").dataset.direction).toBe(direction);
});

it("keeps the entry out of the module row", () => {
  renderStrip();

  for (const module of screen.getAllByTestId("dock-module")) {
    expect(module.contains(screen.getByTestId("dock-toolbar-toggle"))).toBe(false);
  }
});
```

In the test `passes controls down to the timer-only transport module`, replace
`expect(screen.queryByRole("button")).toBeNull();` with:

```jsx
expect(within(screen.getByTestId("dock-module")).queryByRole("button")).toBeNull();
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/dock/DockStrip.test.jsx`
Expected: FAIL — no button named `show toolbar`.

- [ ] **Step 3: Add the width token**

In `src/dock/dockTokens.css`, add one line at the end of the first `.dock-strip` block (after
`--ui-dock-readout-w: 5ch;`):

```css
--ui-dock-toolbar-toggle-w: 20px;
```

- [ ] **Step 4: Create the entry**

`src/dock/DockToolbarToggle.jsx`:

```jsx
import { ChevronDown, ChevronUp } from "lucide-react";
import { HoverTip } from "../components/HoverTip.jsx";
import { cn } from "@/lib/utils";

/**
 * The strip's persistent entry to the Dock toolbar. Sized in Dock's own px, not the shell control
 * tokens: the strip's WebView follows Interface Size and the meters beside this do not.
 *
 * @param {{ edge: string, open: boolean, onToggle?: () => void }} props
 */
export function DockToolbarToggle({ edge, open, onToggle }) {
  // Towards where the toolbar will appear while closed, back at the strip while open.
  const direction = (edge === "bottom") !== open ? "up" : "down";
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const tip = open ? "Hide Toolbar" : "Show Toolbar";
  return (
    <HoverTip tip={tip} side="left" align="center" className="h-full shrink-0">
      <button
        type="button"
        data-testid="dock-toolbar-toggle"
        data-direction={direction}
        aria-label={tip.toLowerCase()}
        aria-pressed={open}
        onClick={onToggle}
        className={cn(
          "flex h-full w-[var(--ui-dock-toolbar-toggle-w)] items-center justify-center",
          "bg-transparent text-muted-foreground hover:bg-ui-hover hover:text-foreground",
          open && "bg-ui-hover text-foreground"
        )}
      >
        <Icon className="size-3" />
      </button>
    </HoverTip>
  );
}
```

- [ ] **Step 5: Let `RecordingIndicator` be offset**

`src/components/RecordingIndicator.jsx` becomes:

```jsx
import { LAYER_INDICATOR } from "./ui/layers.js";
import { cn } from "@/lib/utils";

/** @param {{ state?: string | null, className?: string }} props */
export function RecordingIndicator({ state, className }) {
  if (!state || state === "completed" || state === "failed") return null;
  return (
    <div
      role="status"
      aria-label="visual recording active"
      title={state === "stopping" ? "Finalizing Recording" : "Recording"}
      className={cn(
        "pointer-events-none fixed right-1 top-1 h-2 w-2 rounded-full bg-[color:var(--ui-activity-live)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--background)_75%,transparent)]",
        LAYER_INDICATOR,
        className
      )}
      data-recording-state={state}
    />
  );
}
```

- [ ] **Step 6: Render the entry in the strip**

In `src/dock/DockStrip.jsx`:

Add `import { DockToolbarToggle } from "./DockToolbarToggle.jsx";`.

In the JSDoc and the parameter list, replace the two pointer props with
`toolbarOpen?: boolean,` / `onToolbarToggle?: () => void,` and `toolbarOpen = false,` /
`onToolbarToggle,`. Delete `onPointerEnter={onPointerEnter}` and `onPointerLeave={onPointerLeave}`
from the root `div`.

Wrap the module row so the entry sits after it. The current

```jsx
      <div className="flex h-full min-w-0 items-stretch">
        {panels.map((panel, index) => {
          /* unchanged */
        })}
      </div>
      <RecordingIndicator state={recordingState} />
```

becomes

```jsx
      <div className="flex h-full min-w-0 items-stretch">
        <div className="flex h-full min-w-0 flex-1 items-stretch">
          {panels.map((panel, index) => {
            /* unchanged */
          })}
        </div>
        <DockToolbarToggle edge={edge} open={toolbarOpen} onToggle={onToolbarToggle} />
      </div>
      <RecordingIndicator
        state={recordingState}
        className="right-[calc(var(--ui-dock-toolbar-toggle-w)+0.25rem)]"
      />
```

Keep the body of the `panels.map` callback exactly as it is; only its indentation changes.

- [ ] **Step 7: Wire the strip to the hook**

In `src/App.jsx`, add to `dockProps` where the two pointer props used to be:

```js
        toolbarOpen: dockAccessoryVisibility.headerVisible,
        onToolbarToggle: dockAccessoryVisibility.toggleToolbar,
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/dock src/components`
Expected: PASS.

- [ ] **Step 9: Update the user guide**

In `docs/user/workspace.md`, in the Dock section, replace the sentence

> Hovering the strip shows a header for switching the Loudness Profile and editing which modules the
> strip shows.

with

> Click the arrow at the right end of the strip to show the Dock toolbar, where you can start and
> stop measuring, clear the session, switch the Loudness Profile, edit which modules the strip
> shows, and manage Presets. The toolbar closes when you click the arrow again, press Escape, or
> click anywhere outside PLVS; moving the pointer over the strip never opens or closes it.

Re-wrap the paragraph to the file's line width by running
`npx prettier --write docs/user/workspace.md`.

- [ ] **Step 10: Run the commit checks and commit**

Run: `npm test && npm run format:check && npm run lint && npm run typecheck`
Expected: all green. `npm test` includes `scripts/documentationStructure.test.js`.

```bash
git add src/dock src/components/RecordingIndicator.jsx src/App.jsx docs/user/workspace.md
git commit -m "feat(dock): open the toolbar from an entry on the strip" -m "The Dock toolbar no longer appears on hover. A persistent arrow at the right end of the strip toggles it; Escape or clicking outside PLVS closes it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Header layout and the 36 px height

**Files:**

- Modify: `src/dock/dockSizing.js`
- Modify: `src/dock/dockSizing.test.js`
- Modify: `src/dock/accessories/DockHeader.jsx`
- Modify: `src/dock/accessories/DockHeader.test.jsx`
- Modify: `src/dock/DockAccessoriesContext.jsx:140`
- Modify: `src-tauri/src/dock.rs` (constant at line 28, test literals near 1188, 1197, 1205, 1254)
- Modify: `docs/architecture.md` ("Dock three-window boundary")

**Interfaces:**

- Produces: `DOCK_HEADER_HEIGHT = 36` exported from `src/dock/dockSizing.js`;
  `DOCK_HEADER_LOGICAL_HEIGHT: f64 = 36.0` in Rust; `data-testid="dock-header-actions"` replaces
  `dock-header-controls`.

- [ ] **Step 1: Write the failing cross-side height test**

In `src/dock/dockSizing.test.js`, add `DOCK_HEADER_HEIGHT,` to the existing import from
`./dockSizing.js` and add `import { UI_PREFERENCES } from "../preferences/data.js";`. The file
already imports `readFileSync`, `dirname`, `join` and `fileURLToPath`. Then add:

```js
describe("Dock header height", () => {
  it("is what the shell header classes produce at the Small profile accessories are pinned to", () => {
    const { control, header } = UI_PREFERENCES.layout;
    // --ui-shell-h is --ui-control-h + 4px; --ui-header-pad-y applies above and below.
    expect(control.heightPx + 4 + 2 * header.paddingYRem * 16).toBe(DOCK_HEADER_HEIGHT);
  });

  it("matches the native window height Rust gives the header", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dockRs = readFileSync(join(here, "../../src-tauri/src/dock.rs"), "utf8");
    expect(dockRs).toContain(
      `pub const DOCK_HEADER_LOGICAL_HEIGHT: f64 = ${DOCK_HEADER_HEIGHT}.0;`
    );
  });
});
```

- [ ] **Step 2: Write the failing layout test**

In `src/dock/accessories/DockHeader.test.jsx`, replace the test
`centers transport and Dock tools as one compact group` with:

```jsx
it("puts transport at the start and the Dock tools in the trailing actions group", () => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
  render(<DockHeader state={STATE} onAction={vi.fn()} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    null,
    "Clear",
    "Loudness Profile",
    "Edit modules",
    "Stop reserving screen space",
    "Dock to top",
    "Restore window",
    "Presets",
  ]);
  const actions = screen.getByTestId("dock-header-actions");
  expect(actions.contains(buttons[0])).toBe(false);
  expect(buttons.slice(1).every((button) => actions.contains(button))).toBe(true);
  expect(actions.previousElementSibling?.className).toContain("flex-1");
});

it("keeps an error notice beside the transport, outside the actions group", () => {
  render(
    <DockHeader
      state={{ ...STATE, notice: { kind: "error", text: "Capture failed" } }}
      onAction={vi.fn()}
    />
  );
  const notice = screen.getByText("Capture failed");
  expect(screen.getByTestId("dock-header-actions").contains(notice)).toBe(false);
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run src/dock/dockSizing.test.js src/dock/accessories/DockHeader.test.jsx`
Expected: FAIL — `DOCK_HEADER_HEIGHT` is undefined and `dock-header-actions` is not found.

- [ ] **Step 4: Add the shared constant and use it**

Add to `src/dock/dockSizing.js`, after `DOCK_EXPANDED_MIN_HEIGHT`:

```js
/// Height of the Dock toolbar window. Matches Rust's DOCK_HEADER_LOGICAL_HEIGHT, and is what the
/// shell header classes come to at the Small interface profile accessory WebViews are pinned to.
export const DOCK_HEADER_HEIGHT = 36;
```

In `src/dock/DockAccessoriesContext.jsx`, import `DOCK_HEADER_HEIGHT` from `./dockSizing.js` and
change `height: 44,` in `accessoryGeometry.dockHeader` to `height: DOCK_HEADER_HEIGHT,`.

- [ ] **Step 5: Change the Rust constant and its tests**

In `src-tauri/src/dock.rs`:

```rust
pub const DOCK_HEADER_LOGICAL_HEIGHT: f64 = 36.0;
```

In `bottom_accessories_open_above_the_strip_and_anchor_editor`, the two expected tuples become:

```rust
      (0, 1040 - 72 - 36, 1920, 36)
```

```rust
      (1200 - 400 / 2, 1040 - 72 - 36 - 480, 400, 480)
```

In `top_accessories_open_below_the_strip_at_scaled_size` (scale 1.5, so the header is 54 px), the
header shrinks and the editor starts 12 px higher:

```rust
    assert_eq!((rects.header.y, rects.header.height), (108, 54));
    assert_eq!(
      (rects.editor.y, rects.editor.width, rects.editor.height),
      (162, 600, 450)
    );
```

`accessories_respect_negative_secondary_monitor_offsets` is a top Dock whose header starts at the
strip's inner edge, so its expectations do not change.

In `editor_is_clamped_when_monitor_cannot_fit_preferred_size`, the header moves 8 px toward the
strip and the editor gains the 8 px:

```rust
    assert_eq!((rects.header.y, rects.header.height), (152, 36));
    assert_eq!((rects.editor.x, rects.editor.y), (18, 20));
    assert_eq!((rects.editor.width, rects.editor.height), (304, 132));
```

- [ ] **Step 6: Run the Rust tests**

Run: `npm run rust:test`
Expected: PASS. If another test still asserts a rectangle derived from the old 44 px, recompute its
expected value from the test's own inputs with `header_height = round(36 × scale)` and update the
literal. Do not change non-test code to make a test pass.

- [ ] **Step 7: Restyle the header**

In `src/dock/accessories/DockHeader.jsx`:

Add `import { SHELL_HEADER, SHELL_HEADER_ACTIONS } from "@/lib/shellLayout";`.

Add this constant above the component:

```jsx
const ACTION_ICON_CLASS = "size-[length:var(--ui-icon-shell-action)]";
```

Replace every `className="size-3.5"` on a lucide icon in this file with
`className={ACTION_ICON_CLASS}` (eight icons).

Replace the root `div`'s `className` with:

```jsx
      className={cn(
        SHELL_HEADER,
        // A window-wide bar against the screen edge, not a card inside a padded shell.
        "h-screen w-screen select-none rounded-none text-foreground"
      )}
```

Remove the wrapper `<div data-testid="dock-header-controls" className="flex min-w-0 max-w-full
items-center gap-2">` and its closing tag, so its children become direct children of the root, and
group the buttons. The children of the root, in order, are now:

1. `<SourceTransportCluster ... />` — unchanged.
2. The `state.notice` block — unchanged.
3. `<div className="flex-1" />`
4. `<div data-testid="dock-header-actions" className={SHELL_HEADER_ACTIONS}>` containing the seven
   `IconButton`s (Clear, Loudness Profile, Edit modules, the conditional Reserve Screen Space, the
   edge switch, Restore window, Presets) in their current order, unchanged apart from the icon
   class.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/dock && npm run rust:test`
Expected: PASS.

- [ ] **Step 9: Update the architecture doc**

In `docs/architecture.md`, "Dock three-window boundary", first paragraph, replace

> `dock-header` is a full-width 44 logical px transient toolbar;

with

> `dock-header` is a full-width 36 logical px toolbar, shown when the user opens it from the strip's
> entry, while an editor is open, or while an error notice stands;

and replace "so hovering never reflows maximized windows" at the end of that paragraph with
"so opening the toolbar never reflows maximized windows". Run
`npx prettier --write docs/architecture.md`.

- [ ] **Step 10: Run the commit checks and commit**

Run: `npm test && npm run format:check && npm run lint && npm run typecheck && npm run rust:check`
Expected: all green.

```bash
git add src/dock src-tauri/src/dock.rs docs/architecture.md
git commit -m "feat(dock): lay the toolbar out like the window header" -m "Transport sits at the start and the actions at the end, on the panel surface without divider lines. The toolbar window is 36 px tall, the shell header's height at the Small profile Dock accessories are pinned to." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Remove the cursor poll's Rust half; keep focus in PLVS when an editor closes

**Files:**

- Modify: `src-tauri/src/dock_accessories.rs`
- Modify: `src-tauri/src/lib.rs:275`
- Modify: `src/ipc/commands.js:178-181`
- Modify: `src/ipc/commands.test.js`
- Modify: `docs/architecture.md` ("Dock three-window boundary", second paragraph)

**Interfaces:**

- Removes the Tauri command `cursor_over_dock_surfaces` and `cursorOverDockSurfaces()`.
- `set_dock_accessories` keeps its signature.

- [ ] **Step 1: Confirm nothing still calls the command**

Run: `git grep -n "cursorOverDockSurfaces\|cursor_over_dock_surfaces" -- src src-tauri scripts`
Expected: matches only in `src/ipc/commands.js`, `src/ipc/commands.test.js`,
`src-tauri/src/dock_accessories.rs` and `src-tauri/src/lib.rs`. If the hook or its test still
appears, Task 1 is incomplete; stop.

- [ ] **Step 2: Remove the JS wrapper and its test**

In `src/ipc/commands.js` delete:

```js
/** Whether the global cursor is inside any visible Dock surface window. */
export function cursorOverDockSurfaces() {
  return invoke("cursor_over_dock_surfaces");
}
```

In `src/ipc/commands.test.js` delete `cursorOverDockSurfaces,` from the import list and delete this
test from `describe("dock command seam", ...)`:

```js
it("asks Rust to reconcile the cursor against live Dock window geometry", async () => {
  await cursorOverDockSurfaces();
  expect(invoke).toHaveBeenCalledWith("cursor_over_dock_surfaces");
});
```

- [ ] **Step 3: Remove the Rust command**

In `src-tauri/src/dock_accessories.rs` delete the functions `point_inside`,
`visible_window_contains` and `cursor_over_dock_surfaces` (with its `#[tauri::command]`
attribute), and delete the whole `#[cfg(test)] mod tests` block at the end of the file — its only
test covers `point_inside`.

In `src-tauri/src/lib.rs` delete the line `dock_accessories::cursor_over_dock_surfaces,` from the
`invoke_handler` list.

Run: `npm run rust:check`
Expected: no errors and no warnings. If the compiler reports an unused import in
`dock_accessories.rs` (for example `WindowBounds`), check whether `set_rect` still uses it before
removing it.

- [ ] **Step 4: Hand focus to the header when a focused editor closes**

In `set_dock_accessories` in `src-tauri/src/dock_accessories.rs`, replace the final block

```rust
  if let Some(header) = header {
    set_rect(&header, rects.header)?;
    show_or_hide(&header, header_visible, false)?;
  }
  if let Some(editor) = editor {
    set_rect(&editor, rects.editor)?;
    show_or_hide(&editor, editor_visible, true)?;
  }
  Ok(())
```

with

```rust
  let editor_had_focus = editor
    .as_ref()
    .is_some_and(|editor| editor.is_focused().unwrap_or(false));
  if let Some(header) = &header {
    set_rect(header, rects.header)?;
    show_or_hide(header, header_visible, false)?;
  }
  if let Some(editor) = &editor {
    set_rect(editor, rects.editor)?;
    show_or_hide(editor, editor_visible, true)?;
  }
  // Hiding the window that holds focus hands focus to whatever is behind PLVS. The
  // frontend would read that as the user leaving and close the toolbar under them.
  if editor_had_focus && !editor_visible && header_visible {
    if let Some(header) = &header {
      let _ = header.set_focus();
    }
  }
  Ok(())
```

Run: `npm run rust:check && npm run rust:test`
Expected: green.

- [ ] **Step 5: Update the architecture doc**

In `docs/architecture.md`, "Dock three-window boundary", second paragraph, replace the last
sentence

> The hover poll reports "not over Dock" meanwhile, so the cursor crossing the hidden strip's
> rectangle cannot raise the header over the full-screen window.

with

> Nothing raises the header meanwhile: it is opened only from the strip's entry, and the
> full-screen window taking the foreground closes a toolbar that was already open, through the same
> focus rule that closes it when the user clicks another application.

After that paragraph add:

> Toolbar visibility is owned by `useDockAccessoryVisibility`: an explicit open flag, or an open
> editor, or an error notice. Each of the three WebViews reports its own window focus — the strip
> directly, the accessories over `dock-accessory://focus` — and the toolbar closes once none of them
> has had focus for a short grace period. Pointer position is not an input.

Run `npx prettier --write docs/architecture.md`.

- [ ] **Step 6: Run the commit checks and commit**

Run: `npm test && npm run format:check && npm run lint && npm run typecheck && npm run rust:check`
Expected: all green.

```bash
git add src/ipc/commands.js src/ipc/commands.test.js src-tauri/src/dock_accessories.rs src-tauri/src/lib.rs docs/architecture.md
git commit -m "refactor(dock): drop the cursor poll command" -m "Nothing reads the cursor position any more. Closing an editor that holds focus now hands focus to the header instead of letting it fall out of PLVS." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify in the running app

No code is planned here. A failure in this task is fixed in the task that owns the code, with its
own test where one is possible, and committed there.

- [ ] **Step 1: Run the merge gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 2: Cold-start the dev app from this worktree**

Stop any PLVS Dev process by PID, then `npm run desktop:dev`. Enter Dock on the bottom edge.

- [ ] **Step 3: Capture the "after" images**

With the toolbar closed:

```bash
npm run desktop:control -- visual screenshot --target main --out artifacts/ui-review/dock-toolbar/after/strip.png --json
```

Click the entry with the real pointer, then, without giving another application focus (run the CLI
from a background shell, not a foreground terminal):

```bash
npm run desktop:control -- visual screenshot --target dock-header --out artifacts/ui-review/dock-toolbar/after/header.png --json
```

Compare with Task 0's images by eye and by size:

- `after/header.png` is 36 × the display scale tall (`before` was 44 ×).
- Transport is at the left edge, the seven actions at the right, no line above or below.
- `after/strip.png` matches `before/strip.png` except for the 20 px entry column at the right and
  the modules laid out in the remaining width.

- [ ] **Step 4: Walk the behaviour by hand on Windows**

Each line is an expectation; note any that fails.

1. Sweeping the pointer across the strip shows nothing.
2. Clicking the entry shows the toolbar; the chevron flips and the entry stays highlighted.
3. Clicking the entry again hides it.
4. With the toolbar open, clicking a true-peak readout on the strip resets it and the toolbar stays.
5. With the toolbar open, clicking another application hides it.
6. With the toolbar open, Escape hides it — once with the strip focused, once after clicking a
   toolbar button.
7. Open Modules. Escape closes the editor and the toolbar stays (Review Focus 1). A second Escape
   hides the toolbar.
8. Open Presets, then click the entry: editor and toolbar close together.
9. Open Modules, then click another application: editor and toolbar both close.
10. Trigger an error notice (for example Reserve Screen Space on an edge another workbench holds):
    the toolbar appears by itself, the entry reads as pressed, and neither Escape nor clicking
    another application hides it until the notice clears.
11. Open the toolbar, then put a browser video on the Dock's monitor into full screen: the toolbar
    is gone and does not sit over the video (Review Focus 5). Leave full screen: the strip returns
    with the toolbar closed.
12. Settings → Interface Size → Extra Large, re-enter Dock: the entry and the toolbar are the same
    size as before.
13. Dock on the top edge: the chevron points down while closed, the toolbar opens below the strip.
14. Start a visual recording (`npm run smoke:agent-control` does): the recording dot sits left of
    the entry, not on it.

If item 11 fails, the inference in Review Focus 5 was wrong. The fix is to make Windows report the
yield: emit an event to `main` from `appbar.rs` when `set_yielded(_, true)` runs and call
`dismiss`-equivalent closing in the hook. Stop and raise it with the user before adding that.

- [ ] **Step 5: Hand the macOS checks to the user**

These cannot be run on this machine. Ask the user to check, on macOS:

1. Clicking the entry opens the toolbar and clicking another application closes it.
2. Escape closes it.
3. Opening and closing an editor leaves the toolbar open.

If item 1 fails on macOS, apply the spec's fallback: on macOS the toolbar closes on the entry and
Escape only, and `docs/user/workspace.md` says so.

- [ ] **Step 6: Stop the dev app by PID and report**

Report what was verified, what failed, and what is waiting on the macOS check. Do not merge; the
user decides how the branch lands.
