# System Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system tray icon to PLVS with a dynamic context menu, and replace the default window close behavior with a custom "Minimize to tray / Quit" dialog.

**Architecture:** The tray is created and managed from the frontend JS using `@tauri-apps/plugin-tray` (no Rust state sync needed). Window close is intercepted via Tauri's `onCloseRequested` event on the frontend; a custom shadcn-style dialog appears unless the user has saved a preference to localStorage. The `useTray` hook is side-effect only and consumes existing state from `AppContent`. The `useCloseConfirm` hook drives the dialog.

**Tech Stack:** React 19, `@tauri-apps/plugin-tray`, `@tauri-apps/api/menu`, `@tauri-apps/plugin-process`, `@radix-ui/react-dialog`, Vitest + Testing Library, Tauri 2.x capabilities.

---

## File Map

**New files:**
- `src/hooks/useTray.js` — creates tray icon on mount, rebuilds menu when state changes, handles left-click show/hide
- `src/hooks/useCloseConfirm.js` — intercepts window close-requested, reads/writes `plvs:closeAction` from localStorage, exposes dialog open state and handlers
- `src/components/CloseConfirmDialog.jsx` — modal dialog UI (radio: Minimize to tray / Quit, checkbox: Don't ask again)
- `src/hooks/useCloseConfirm.test.js` — unit tests for useCloseConfirm
- `src/components/CloseConfirmDialog.test.jsx` — RTL tests for CloseConfirmDialog

**Modified files:**
- `src-tauri/Cargo.toml` — add `tauri-plugin-tray`, `tauri-plugin-process`
- `src-tauri/src/lib.rs` — register both plugins
- `package.json` — add `@tauri-apps/plugin-tray`, `@tauri-apps/plugin-process`
- `src-tauri/capabilities/default.json` — add tray and process permissions
- `src/App.jsx` — call `useTray`, call `useCloseConfirm`, render `<CloseConfirmDialog>`

---

## Task 1: Add Rust and npm dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `package.json` (via npm install)
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add Rust dependencies to Cargo.toml**

Open `src-tauri/Cargo.toml`. In the `[dependencies]` section, add these two lines after the existing `tauri-plugin-opener` line:

```toml
tauri-plugin-tray = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register the plugins in lib.rs**

Open `src-tauri/src/lib.rs`. The current `run()` function has `.plugin(tauri_plugin_opener::init())` on line 18. Add two more plugin calls after it:

```rust
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_tray::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    // ... rest unchanged
```

- [ ] **Step 3: Install npm packages**

```
npm install @tauri-apps/plugin-tray @tauri-apps/plugin-process
```

Verify both appear in `package.json` under `"dependencies"`.

- [ ] **Step 4: Add capabilities for new plugins**

Open `src-tauri/capabilities/default.json`. The `"permissions"` array currently ends with `"core:window:allow-set-always-on-top"`. Append these entries:

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
    "core:window:allow-set-always-on-top",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-is-visible",
    "core:window:allow-set-skip-taskbar",
    "core:window:allow-set-focus",
    "tray:default",
    "process:allow-exit"
  ]
}
```

- [ ] **Step 5: Verify app still compiles and starts**

```
npm run desktop
```

Expected: app launches with no errors. The tray icon will not appear yet — that comes in Task 4.

- [ ] **Step 6: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs package.json package-lock.json src-tauri/capabilities/default.json
git commit -m "feat(tray): add tauri-plugin-tray and tauri-plugin-process dependencies"
```

---

## Task 2: CloseConfirmDialog component

**Files:**
- Create: `src/components/CloseConfirmDialog.jsx`
- Create: `src/components/CloseConfirmDialog.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/CloseConfirmDialog.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog.jsx";

describe("CloseConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(<CloseConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("Close PLVS")).toBeNull();
  });

  it("renders dialog title when open=true", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Close PLVS")).toBeTruthy();
  });

  it("shows both options", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Minimize to tray")).toBeTruthy();
    expect(screen.getByText("Quit")).toBeTruthy();
  });

  it("defaults to Minimize to tray selected", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0].checked).toBe(true);  // Minimize to tray
    expect(radios[1].checked).toBe(false); // Quit
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onConfirm('tray', false) when Confirm clicked with defaults", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("tray", false);
  });

  it("calls onConfirm('quit', false) when Quit is selected then Confirm clicked", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("radio")[1]); // Quit
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("quit", false);
  });

  it("calls onConfirm with dontAskAgain=true when checkbox is checked", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("tray", true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/components/CloseConfirmDialog.test.jsx
```

Expected: all tests FAIL with "Cannot find module './CloseConfirmDialog.jsx'".

- [ ] **Step 3: Implement CloseConfirmDialog.jsx**

Create `src/components/CloseConfirmDialog.jsx`:

```jsx
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export function CloseConfirmDialog({ open, onConfirm, onCancel }) {
  const [action, setAction] = useState("tray");
  const [dontAsk, setDontAsk] = useState(false);

  function handleConfirm() {
    const a = action;
    const d = dontAsk;
    setAction("tray");
    setDontAsk(false);
    onConfirm(a, d);
  }

  function handleCancel() {
    setAction("tray");
    setDontAsk(false);
    onCancel();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus:outline-none">
          <Dialog.Title className="mb-5 text-sm font-semibold text-foreground">
            Close PLVS
          </Dialog.Title>

          <div className="mb-4 space-y-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="closeAction"
                value="tray"
                checked={action === "tray"}
                onChange={() => setAction("tray")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Minimize to tray</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="closeAction"
                value="quit"
                checked={action === "quit"}
                onChange={() => setAction("quit")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Quit</span>
            </label>
          </div>

          <label className="mb-6 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-sm text-muted-foreground">Don't ask again</span>
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Confirm
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/components/CloseConfirmDialog.test.jsx
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/components/CloseConfirmDialog.jsx src/components/CloseConfirmDialog.test.jsx
git commit -m "feat(tray): add CloseConfirmDialog component"
```

---

## Task 3: useCloseConfirm hook

**Files:**
- Create: `src/hooks/useCloseConfirm.js`
- Create: `src/hooks/useCloseConfirm.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useCloseConfirm.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCloseConfirm } from "./useCloseConfirm.js";

const mockExit = vi.fn().mockResolvedValue(undefined);
let closeRequestedCallback = null;

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (cb) => {
      closeRequestedCallback = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: mockExit,
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

describe("useCloseConfirm", () => {
  const onHideWindow = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.clear();
    closeRequestedCallback = null;
    mockExit.mockClear();
    onHideWindow.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("dialogOpen starts false", () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    expect(result.current.dialogOpen).toBe(false);
  });

  it("opens dialog when no preference saved and close is requested", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback({ preventDefault: vi.fn() });
    });
    expect(result.current.dialogOpen).toBe(true);
  });

  it("hides window without dialog when saved preference is 'tray'", async () => {
    localStorage.setItem("plvs:closeAction", "tray");
    renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback({ preventDefault: vi.fn() });
    });
    expect(onHideWindow).toHaveBeenCalled();
  });

  it("does not open dialog when saved preference is 'tray'", async () => {
    localStorage.setItem("plvs:closeAction", "tray");
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback({ preventDefault: vi.fn() });
    });
    expect(result.current.dialogOpen).toBe(false);
  });

  it("calls exit(0) without dialog when saved preference is 'quit'", async () => {
    localStorage.setItem("plvs:closeAction", "quit");
    renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback({ preventDefault: vi.fn() });
    });
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("handleConfirm('tray', false) calls onHideWindow and closes dialog", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback({ preventDefault: vi.fn() });
    });
    await act(async () => {
      await result.current.handleConfirm("tray", false);
    });
    expect(onHideWindow).toHaveBeenCalled();
    expect(result.current.dialogOpen).toBe(false);
  });

  it("handleConfirm('quit', false) calls exit(0)", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await result.current.handleConfirm("quit", false);
    });
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("handleConfirm with dontAskAgain=true writes to localStorage", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await result.current.handleConfirm("tray", true);
    });
    expect(localStorage.getItem("plvs:closeAction")).toBe("tray");
  });

  it("handleConfirm with dontAskAgain=false does not write to localStorage", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await result.current.handleConfirm("tray", false);
    });
    expect(localStorage.getItem("plvs:closeAction")).toBeNull();
  });

  it("handleCancel closes dialog without any action", () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    act(() => result.current.handleCancel());
    expect(result.current.dialogOpen).toBe(false);
    expect(onHideWindow).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/hooks/useCloseConfirm.test.js
```

Expected: all tests FAIL with "Cannot find module './useCloseConfirm.js'".

- [ ] **Step 3: Implement useCloseConfirm.js**

Create `src/hooks/useCloseConfirm.js`:

```js
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";

const STORAGE_KEY = "plvs:closeAction";

export function useCloseConfirm({ onHideWindow }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten;
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        e.preventDefault();
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "tray") {
          await onHideWindow();
          return;
        }
        if (saved === "quit") {
          await exit(0);
          return;
        }
        setDialogOpen(true);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [onHideWindow]);

  async function handleConfirm(action, dontAskAgain) {
    setDialogOpen(false);
    if (dontAskAgain) {
      localStorage.setItem(STORAGE_KEY, action);
    }
    if (action === "tray") {
      await onHideWindow();
    } else {
      await exit(0);
    }
  }

  function handleCancel() {
    setDialogOpen(false);
  }

  return { dialogOpen, handleConfirm, handleCancel };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/hooks/useCloseConfirm.test.js
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/hooks/useCloseConfirm.js src/hooks/useCloseConfirm.test.js
git commit -m "feat(tray): add useCloseConfirm hook"
```

---

## Task 4: useTray hook

**Files:**
- Create: `src/hooks/useTray.js`

No unit tests for this hook — it has hard dependencies on Tauri window APIs that are not meaningful to mock (the tray only exists in the real app). Manual verification is in Task 5.

- [ ] **Step 1: Implement useTray.js**

Create `src/hooks/useTray.js`:

```js
import { useEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/plugin-tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";

async function buildMenu({ running, pinned, onToggleCapture, onTogglePin, deviceName, onToggleWindow }) {
  const win = getCurrentWindow();
  const isVisible = await win.isVisible();

  return Menu.new({
    items: [
      await MenuItem.new({
        text: isVisible ? "Hide Window" : "Show Window",
        action: onToggleWindow,
      }),
      await MenuItem.new({
        text: pinned ? "Unpin Window" : "Pin Window",
        action: onTogglePin,
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        text: running ? "Stop" : "Start",
        action: onToggleCapture,
      }),
      await MenuItem.new({
        text: deviceName ?? "No device",
        enabled: false,
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        text: "Quit",
        action: () => exit(0),
      }),
    ],
  });
}

export function useTray({ running, pinned, togglePin, onStartClick, deviceName, onToggleWindow }) {
  const trayRef = useRef(null);
  const togglePinRef = useRef(togglePin);
  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);

  useEffect(() => { togglePinRef.current = togglePin; }, [togglePin]);
  useEffect(() => { onStartClickRef.current = onStartClick; }, [onStartClick]);
  useEffect(() => { onToggleWindowRef.current = onToggleWindow; }, [onToggleWindow]);

  // Stable callbacks that always call the latest ref
  const stableTogglePin = useRef(() => togglePinRef.current()).current;
  const stableToggleCapture = useRef(() => onStartClickRef.current()).current;
  const stableToggleWindow = useRef(() => onToggleWindowRef.current()).current;

  // Snapshot of state for the creation effect (refs keep it current after creation)
  const creationStateRef = useRef({ running, pinned, deviceName });
  useEffect(() => {
    creationStateRef.current = { running, pinned, deviceName };
  }, [running, pinned, deviceName]);

  // Create tray once on mount
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const { running: r, pinned: p, deviceName: d } = creationStateRef.current;
      const menu = await buildMenu({
        running: r,
        pinned: p,
        onToggleCapture: stableToggleCapture,
        onTogglePin: stableTogglePin,
        deviceName: d,
        onToggleWindow: stableToggleWindow,
      });

      const tray = await TrayIcon.new({
        tooltip: "PLVS",
        menu,
        menuOnLeftClick: false,
        action: (e) => {
          if (e.type === "Click" && e.button === "Left") {
            stableToggleWindow();
          }
        },
      });

      if (!cancelled) trayRef.current = tray;
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
      trayRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild menu when state changes
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;

    (async () => {
      const menu = await buildMenu({
        running,
        pinned,
        onToggleCapture: stableToggleCapture,
        onTogglePin: stableTogglePin,
        deviceName,
        onToggleWindow: stableToggleWindow,
      });
      await trayRef.current.setMenu(menu);
    })();
  }, [running, pinned, deviceName, stableToggleCapture, stableTogglePin, stableToggleWindow]);
}
```

- [ ] **Step 2: Commit**

```
git add src/hooks/useTray.js
git commit -m "feat(tray): add useTray hook"
```

---

## Task 5: Wire into App.jsx and end-to-end verification

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports to App.jsx**

At the top of `src/App.jsx`, add these imports alongside the existing ones:

```js
import { useCallback } from "react"; // already imported — verify it's in the destructure from "react"
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
```

Note: `useCallback` is already imported from `"react"` on line 1 of `App.jsx` — just verify it's there.

- [ ] **Step 2: Add onToggleWindow and onHideWindow callbacks in AppContent**

In `AppContent`, after the line `const { pinned, togglePin } = useAlwaysOnTop();` (around line 114), add:

```js
const onHideWindow = useCallback(async () => {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  await win.hide();
  await win.setSkipTaskbar(true);
}, []);

const onToggleWindow = useCallback(async () => {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  const visible = await win.isVisible();
  if (visible) {
    await win.hide();
    await win.setSkipTaskbar(true);
  } else {
    await win.show();
    await win.setSkipTaskbar(false);
    await win.setFocus();
  }
}, []);
```

- [ ] **Step 3: Call useTray in AppContent**

After the `onToggleWindow` definition, add:

```js
useTray({
  running,
  pinned,
  togglePin,
  onStartClick,
  deviceName,
  onToggleWindow,
});
```

- [ ] **Step 4: Call useCloseConfirm in AppContent**

After the `useTray` call, add:

```js
const { dialogOpen: closeDialogOpen, handleConfirm: handleCloseConfirm, handleCancel: handleCloseCancel } =
  useCloseConfirm({ onHideWindow });
```

- [ ] **Step 5: Render CloseConfirmDialog**

In the JSX returned by `AppContent`, find the closing `</AudioDataContext.Provider>` tag (the last tag before the function closes). Add `<CloseConfirmDialog>` just before it:

```jsx
      <SettingsPanel ... />

      <CloseConfirmDialog
        open={closeDialogOpen}
        onConfirm={handleCloseConfirm}
        onCancel={handleCloseCancel}
      />
    </div>
  </AudioDataContext.Provider>
```

- [ ] **Step 6: Run existing test suite to verify no regressions**

```
npm test
```

Expected: all existing tests PASS (the new hooks and component tests are included automatically).

- [ ] **Step 7: Start the app and verify tray behavior**

```
npm run desktop
```

Manual checklist:
- [ ] Tray icon appears in the Windows system tray (bottom-right corner)
- [ ] Left-clicking the tray icon hides the window and removes it from taskbar
- [ ] Left-clicking the tray icon again shows the window and restores it in taskbar
- [ ] Right-clicking the tray icon shows the menu with all 5 items
- [ ] "Show Window / Hide Window" label matches the actual window state
- [ ] "Pin Window / Unpin Window" label matches the pin button state
- [ ] Clicking "Pin Window" from the tray toggles pin (and the toolbar button reflects it)
- [ ] "Start / Stop" label matches the running state
- [ ] Clicking "Start" from the tray starts capture
- [ ] Device name appears as a disabled item showing the current device
- [ ] Clicking "Quit" exits the app
- [ ] Clicking the window's × button shows the CloseConfirmDialog
- [ ] Selecting "Minimize to tray" + Confirm hides the window (not in taskbar)
- [ ] Selecting "Quit" + Confirm exits the app
- [ ] Cancel leaves the window open
- [ ] Checking "Don't ask again" + Confirm: next time × is clicked, no dialog appears
- [ ] Checking "Don't ask again" + Confirm with "Minimize to tray": window hides on × click without dialog

- [ ] **Step 8: Commit**

```
git add src/App.jsx
git commit -m "feat(tray): wire useTray and useCloseConfirm into App"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Tray icon + menu with 5 items in correct order
- ✅ Left click = show/hide window; right click = full menu
- ✅ Dynamic menu labels (running, pinned, device name)
- ✅ setSkipTaskbar(true/false) on hide/show
- ✅ macOS: Dock icon stays (plan A, no ActivationPolicy switching)
- ✅ Close dialog with "Minimize to tray" / "Quit" / "Don't ask again"
- ✅ localStorage key `plvs:closeAction` persists preference
- ✅ Tauri 2 frontend JS approach (no Rust state sync needed)

**API note:** If `menuOnLeftClick` is not recognized by the installed version of `@tauri-apps/plugin-tray`, check the plugin's TypeScript types — the option may be named `menu_on_left_click` or the option may need to be set after creation via `tray.setMenuOnLeftClick(false)`.

**Icon note:** If the tray icon doesn't appear (no `icon` option is passed), add `icon: await defaultWindowIcon()` from `@tauri-apps/api/app` to `TrayIcon.new({...})`. Some platforms require an explicit icon.
