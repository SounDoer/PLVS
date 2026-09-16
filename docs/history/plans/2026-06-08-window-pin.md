# Window Pin (Always on Top) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar toggle button that pins the PLVS window above all other OS windows, with state persisted across launches.

**Architecture:** Tauri capability permission grants the frontend the right to call `setAlwaysOnTop()` directly via `@tauri-apps/api/window`. A `useAlwaysOnTop` hook owns the boolean state, applies it to the window on mount (for restore) and on every toggle, and persists to `localStorage`. A button in `App.jsx` renders between the audio device selector and the layout popover, guarded by `isTauri()`.

**Tech Stack:** Tauri 2.x (`core:window:allow-set-always-on-top`), `@tauri-apps/api/window`, React hooks, `localStorage`, `lucide-react` (`Pin` / `PinOff`), Vitest + `@testing-library/react`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/capabilities/default.json` | Modify | Add `allow-set-always-on-top` permission |
| `src/hooks/useAlwaysOnTop.js` | Create | Pin state, window API call, localStorage persistence |
| `src/hooks/useAlwaysOnTop.test.js` | Create | Unit tests for the hook |
| `src/App.jsx` | Modify | Import hook + icons, insert toolbar button |

---

## Task 1: Add Tauri capability permission

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the permission**

Open `src-tauri/capabilities/default.json`. The `permissions` array currently ends with `"store:default"`. Add one entry:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default",
    "core:webview:default",
    {
      "identifier": "opener:allow-open-url",
      "allow": [
        { "url": "https://github.com/SounDoer/PLVS/releases" },
        { "url": "https://github.com/SounDoer/PLVS/releases/*" }
      ]
    },
    "store:default",
    "core:window:allow-set-always-on-top"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(tauri): allow set-always-on-top window permission"
```

---

## Task 2: Create `useAlwaysOnTop` hook (TDD)

**Files:**
- Create: `src/hooks/useAlwaysOnTop.test.js`
- Create: `src/hooks/useAlwaysOnTop.js`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useAlwaysOnTop.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";

const mockSetAlwaysOnTop = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrent: () => ({ setAlwaysOnTop: mockSetAlwaysOnTop }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

describe("useAlwaysOnTop", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetAlwaysOnTop.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("starts unpinned when localStorage is empty", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    expect(result.current.pinned).toBe(false);
  });

  it("starts pinned when localStorage has 'true'", () => {
    localStorage.setItem("plvs:windowPinned", "true");
    const { result } = renderHook(() => useAlwaysOnTop());
    expect(result.current.pinned).toBe(true);
  });

  it("calls setAlwaysOnTop(false) on mount when unpinned", () => {
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("calls setAlwaysOnTop(true) on mount when restored from localStorage", () => {
    localStorage.setItem("plvs:windowPinned", "true");
    renderHook(() => useAlwaysOnTop());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("togglePin flips pinned from false to true", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(true);
  });

  it("togglePin flips pinned from true to false", () => {
    localStorage.setItem("plvs:windowPinned", "true");
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(result.current.pinned).toBe(false);
  });

  it("togglePin writes new value to localStorage", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    act(() => result.current.togglePin());
    expect(localStorage.getItem("plvs:windowPinned")).toBe("true");
  });

  it("togglePin calls setAlwaysOnTop with new value", () => {
    const { result } = renderHook(() => useAlwaysOnTop());
    mockSetAlwaysOnTop.mockClear();
    act(() => result.current.togglePin());
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- useAlwaysOnTop
```

Expected: multiple failures with "Cannot find module './useAlwaysOnTop.js'"

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useAlwaysOnTop.js`:

```js
import { useState, useEffect } from "react";
import { getCurrent } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

const STORAGE_KEY = "plvs:windowPinned";

export function useAlwaysOnTop() {
  const [pinned, setPinned] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    if (!isTauri()) return;
    getCurrent().setAlwaysOnTop(pinned);
  }, [pinned]);

  function togglePin() {
    const next = !pinned;
    localStorage.setItem(STORAGE_KEY, String(next));
    setPinned(next);
  }

  return { pinned, togglePin };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- useAlwaysOnTop
```

Expected: all 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAlwaysOnTop.js src/hooks/useAlwaysOnTop.test.js
git commit -m "feat(hooks): add useAlwaysOnTop hook with localStorage persistence"
```

---

## Task 3: Add Pin button to toolbar in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports**

At the top of `src/App.jsx`, add `Pin` and `PinOff` to the lucide-react import line (currently `import { LayoutGrid, Settings, Trash2, Volume2 } from "lucide-react";`):

```js
import { LayoutGrid, Pin, PinOff, Settings, Trash2, Volume2 } from "lucide-react";
```

Add the hook import alongside the other hook imports:

```js
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
```

- [ ] **Step 2: Call the hook inside the component**

Inside the `App` component function body, alongside the other hook calls (e.g. near `useSettings`, `useSnapshot`), add:

```js
const { pinned, togglePin } = useAlwaysOnTop();
```

- [ ] **Step 3: Insert the button in the toolbar**

Locate the toolbar right-side group in the JSX. The audio device selector block ends with `)}` just before the Layout popover `<Popover>`. Insert the Pin button between those two:

```jsx
{isTauri() && (
  <IconButton
    icon={pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
    tip={pinned ? "Unpin window" : "Pin window on top"}
    onClick={togglePin}
    className={pinned ? "text-foreground" : undefined}
  />
)}
```

The resulting toolbar order will be:
```
[Transport] | [Clear] [AudioDevice] [Pin] [Layout] [Settings]
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (no regressions in `App.toolbar.test.js` or elsewhere)

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ui): add window pin toggle button to toolbar"
```

---

## Verification

After all tasks are complete, run the app in Tauri dev mode and confirm:

1. Pin button appears in the toolbar between the audio device selector and the layout popover
2. Clicking Pin pins the window above other windows (test by switching to another app)
3. Icon changes to `PinOff` and button brightens when pinned
4. Clicking again unpins the window and icon reverts to `Pin`
5. Close and relaunch the app — pin state is restored from the previous session
