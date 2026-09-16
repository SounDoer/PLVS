# Unified Clear Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the in-app `Ctrl+K` clear and the separate global-clear shortcut into one customizable Clear combo (default `CmdOrCtrl+K`) plus a single "works globally" toggle, with a theme-aware error state on registration failure.

**Architecture:** A new `clearShortcutPrefs` module + `useClearShortcut` hook replace the `globalClear*` ones. The combo always drives the in-app window-keydown clear (matched via a new pure `eventMatchesAccelerator`); the toggle additionally registers the same combo system-wide. Settings shows one continuous shortcut list with Clear as the last, editable row. New files are added alongside the old ones, then the old ones are deleted last, so every commit compiles and the suite stays green.

**Tech Stack:** React, Vitest + Testing Library (jsdom), Tauri v2 (`tauri-plugin-global-shortcut`, `tauri-plugin-store`).

Spec: `docs/superpowers/specs/2026-06-11-unified-clear-shortcut-design.md`

---

## File Structure

- `src/lib/accelerator.js` (modify) — add `eventMatchesAccelerator`.
- `src/lib/clearShortcutPrefs.js` (new) — plugin-store load/save for `clearShortcut` + `clearGlobal`.
- `src/hooks/useClearShortcut.js` (new) — combo + global-toggle state and registration lifecycle.
- `src/data/keyboardShortcuts.js` (modify) — drop `clear`, reorder `startStop` last.
- `src/components/ShortcutCapture.jsx` (modify) — aria-label + default-import source.
- `src/components/SettingsPanel.jsx` (modify) — rename props, relabel "Clear", error-state ring, always-editable capture.
- `src/hooks/useSettings.js` (modify) — call `useClearShortcut`.
- `src/App.jsx` (modify) — keydown matcher + renamed destructure/props + `clearShortcut` in `shortcutHandlerRef`.
- `src/lib/globalClearPrefs.js`, `src/hooks/useGlobalClearShortcut.js` + their tests (delete last).

---

### Task 1: `eventMatchesAccelerator` helper

**Files:**
- Modify: `src/lib/accelerator.js`
- Test: `src/lib/accelerator.test.js` (append)

- [ ] **Step 1: Append the failing test to `src/lib/accelerator.test.js`**

```js
describe("eventMatchesAccelerator", () => {
  it("matches an event that produces the accelerator", () => {
    expect(eventMatchesAccelerator({ key: "k", ctrlKey: true }, "CmdOrCtrl+K")).toBe(true);
    expect(eventMatchesAccelerator({ key: "k", metaKey: true }, "CmdOrCtrl+K")).toBe(true);
  });
  it("does not match a different key or missing modifier", () => {
    expect(eventMatchesAccelerator({ key: "j", ctrlKey: true }, "CmdOrCtrl+K")).toBe(false);
    expect(eventMatchesAccelerator({ key: "k" }, "CmdOrCtrl+K")).toBe(false);
  });
});
```

Also add `eventMatchesAccelerator` to the existing top-of-file import from `./accelerator.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/accelerator.test.js`
Expected: FAIL — `eventMatchesAccelerator is not a function` / not exported.

- [ ] **Step 3: Implement — append to `src/lib/accelerator.js`**

```js
/** True when a KeyboardEvent-like object produces exactly `accel`. */
export function eventMatchesAccelerator(e, accel) {
  return keyEventToAccelerator(e) === accel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/accelerator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/accelerator.js src/lib/accelerator.test.js
git commit -m "feat(shortcut): add eventMatchesAccelerator helper"
```

---

### Task 2: New `clearShortcutPrefs` module

**Files:**
- Create: `src/lib/clearShortcutPrefs.js`
- Test: `src/lib/clearShortcutPrefs.test.js`

Old `globalClearPrefs.js` stays for now (deleted in Task 6).

- [ ] **Step 1: Write the failing test — `src/lib/clearShortcutPrefs.test.js`**

```js
import { describe, expect, it } from "vitest";
import {
  loadClearShortcutPrefs,
  saveClearShortcutPrefs,
  DEFAULT_CLEAR_SHORTCUT,
} from "./clearShortcutPrefs.js";

describe("clearShortcutPrefs (non-Tauri)", () => {
  it("default shortcut constant is CmdOrCtrl+K", () => {
    expect(DEFAULT_CLEAR_SHORTCUT).toBe("CmdOrCtrl+K");
  });
  it("loads default shortcut + global false when not in Tauri", async () => {
    await expect(loadClearShortcutPrefs()).resolves.toEqual({
      shortcut: "CmdOrCtrl+K",
      global: false,
    });
  });
  it("save is a no-op (resolves) outside Tauri", async () => {
    await expect(
      saveClearShortcutPrefs({ shortcut: "CmdOrCtrl+K", global: true })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/clearShortcutPrefs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — `src/lib/clearShortcutPrefs.js`**

```js
import { isTauri } from "../ipc/env.js";

const STORE_FILE = "plvs-settings.json";
const SHORTCUT_KEY = "clearShortcut";
const GLOBAL_KEY = "clearGlobal";

export const DEFAULT_CLEAR_SHORTCUT = "CmdOrCtrl+K";

export async function loadClearShortcutPrefs() {
  const fallback = { shortcut: DEFAULT_CLEAR_SHORTCUT, global: false };
  if (!isTauri()) return fallback;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const shortcut = await store.get(SHORTCUT_KEY);
    const global = await store.get(GLOBAL_KEY);
    return {
      shortcut: typeof shortcut === "string" && shortcut ? shortcut : DEFAULT_CLEAR_SHORTCUT,
      global: typeof global === "boolean" ? global : false,
    };
  } catch (_) {
    return fallback;
  }
}

export async function saveClearShortcutPrefs({ shortcut, global }) {
  if (!isTauri()) return;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    await store.set(SHORTCUT_KEY, String(shortcut));
    await store.set(GLOBAL_KEY, Boolean(global));
    await store.save();
  } catch (_) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/clearShortcutPrefs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clearShortcutPrefs.js src/lib/clearShortcutPrefs.test.js
git commit -m "feat(shortcut): add clearShortcutPrefs (clearShortcut + clearGlobal keys)"
```

---

### Task 3: New `useClearShortcut` hook

**Files:**
- Create: `src/hooks/useClearShortcut.js`
- Test: `src/hooks/useClearShortcut.test.jsx`

Old `useGlobalClearShortcut.js` stays for now (deleted in Task 6).

- [ ] **Step 1: Write the failing test — `src/hooks/useClearShortcut.test.jsx`**

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/clearShortcutPrefs.js", () => ({
  DEFAULT_CLEAR_SHORTCUT: "CmdOrCtrl+K",
  loadClearShortcutPrefs: () => Promise.resolve({ shortcut: "CmdOrCtrl+K", global: true }),
  saveClearShortcutPrefs: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));

import { useClearShortcut } from "./useClearShortcut.js";

function Harness({ onClear }) {
  const ref = useRef(onClear);
  ref.current = onClear;
  useClearShortcut(ref);
  return null;
}

beforeEach(() => {
  register.mockReset();
  unregister.mockReset();
});

describe("useClearShortcut", () => {
  it("registers the combo globally when global is true and routes to onClear", async () => {
    const onClear = vi.fn();
    render(<Harness onClear={onClear} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toBe("CmdOrCtrl+K");
    const handler = register.mock.calls[0][1];
    handler({ state: "Pressed" });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useClearShortcut.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — `src/hooks/useClearShortcut.js`**

```js
import { useEffect, useRef, useState } from "react";
import { isTauri } from "../ipc/env.js";
import {
  loadClearShortcutPrefs,
  saveClearShortcutPrefs,
  DEFAULT_CLEAR_SHORTCUT,
} from "../lib/clearShortcutPrefs.js";

/**
 * Owns the Clear shortcut: the combo (always used in-app) and whether it is
 * additionally registered system-wide.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useClearShortcut(onClearRef) {
  const [shortcut, setShortcutState] = useState(DEFAULT_CLEAR_SHORTCUT);
  const [global, setGlobalState] = useState(false);
  const [ready, setReady] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const registeredRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadClearShortcutPrefs().then((prefs) => {
      if (!mounted) return;
      setShortcutState(prefs.shortcut);
      setGlobalState(prefs.global);
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    (async () => {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      if (registeredRef.current && registeredRef.current !== shortcut) {
        try {
          await unregister(registeredRef.current);
        } catch (_) {}
        registeredRef.current = null;
      }
      if (!global) {
        if (registeredRef.current) {
          try {
            await unregister(registeredRef.current);
          } catch (_) {}
          registeredRef.current = null;
        }
        setRegistrationError(null);
        return;
      }
      if (registeredRef.current === shortcut) return;
      try {
        await register(shortcut, (event) => {
          if (event && event.state && event.state !== "Pressed") return;
          onClearRef?.current?.();
        });
        if (!cancelled) {
          registeredRef.current = shortcut;
          setRegistrationError(null);
        }
      } catch (e) {
        if (!cancelled) setRegistrationError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, global, shortcut, onClearRef]);

  useEffect(
    () => () => {
      const current = registeredRef.current;
      if (current && isTauri()) {
        import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) => {
          const result = unregister(current);
          if (result && typeof result.catch === "function") result.catch(() => {});
        });
      }
    },
    []
  );

  function setClearGlobal(next) {
    setGlobalState(next);
    void saveClearShortcutPrefs({ shortcut, global: next });
  }

  function setClearShortcut(next) {
    setShortcutState(next);
    void saveClearShortcutPrefs({ shortcut: next, global });
  }

  return {
    clearShortcut: shortcut,
    clearGlobal: global,
    clearReady: ready,
    registrationError,
    setClearGlobal,
    setClearShortcut,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useClearShortcut.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useClearShortcut.js src/hooks/useClearShortcut.test.jsx
git commit -m "feat(shortcut): add useClearShortcut hook (combo + global toggle)"
```

---

### Task 4: Reorder shortcut list + retarget ShortcutCapture

These two changes are independent of the prop rename and safe to land first.

**Files:**
- Modify: `src/data/keyboardShortcuts.js`
- Test: `src/data/keyboardShortcuts.test.js`
- Modify: `src/components/ShortcutCapture.jsx`
- Test: `src/components/ShortcutCapture.test.jsx`

- [ ] **Step 1: Update the keyboardShortcuts test**

Replace the order assertion in `src/data/keyboardShortcuts.test.js` so it expects `clear` removed and `startStop` last:

```js
  it("lists the read-only shortcuts with startStop last and no clear row", () => {
    expect(KEYBOARD_SHORTCUTS.map((s) => s.id)).toEqual([
      "settings",
      "fullscreen",
      "exitFullscreen",
      "startStop",
    ]);
  });
```

(Keep the existing "each row has a label and keys" test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/keyboardShortcuts.test.js`
Expected: FAIL — current order still includes `clear` and starts with `startStop`.

- [ ] **Step 3: Update `src/data/keyboardShortcuts.js`**

```js
/** Read-only reference list of the app's existing keyboard shortcuts. */
export const KEYBOARD_SHORTCUTS = [
  { id: "settings", label: "Open settings", keys: "CmdOrCtrl+," },
  { id: "fullscreen", label: "Fullscreen panel", keys: "1 – 6" },
  { id: "exitFullscreen", label: "Exit fullscreen", keys: "Escape" },
  { id: "startStop", label: "Start / Stop", keys: "Space" },
];
```

- [ ] **Step 4: Update ShortcutCapture import + aria-label**

In `src/components/ShortcutCapture.jsx`:

Change the default-import line from:
```jsx
import { DEFAULT_GLOBAL_CLEAR_SHORTCUT } from "@/lib/globalClearPrefs.js";
```
to:
```jsx
import { DEFAULT_CLEAR_SHORTCUT } from "@/lib/clearShortcutPrefs.js";
```

Change the Reset `onClick` from `() => onChange(DEFAULT_GLOBAL_CLEAR_SHORTCUT)` to `() => onChange(DEFAULT_CLEAR_SHORTCUT)`.

Change the capture button `aria-label="Global clear shortcut"` to `aria-label="Clear shortcut"`.

- [ ] **Step 5: Update ShortcutCapture test**

In `src/components/ShortcutCapture.test.jsx`, replace every `getByLabelText("Global clear shortcut")` with `getByLabelText("Clear shortcut")` (3 occurrences).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/keyboardShortcuts.test.js src/components/ShortcutCapture.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/keyboardShortcuts.js src/data/keyboardShortcuts.test.js src/components/ShortcutCapture.jsx src/components/ShortcutCapture.test.jsx
git commit -m "feat(shortcut): reorder shortcut list and retarget ShortcutCapture to clear prefs"
```

---

### Task 5: Wire the unified model (useSettings + App + SettingsPanel)

This is the atomic prop/name rename + UI merge. All three files share the prop contract, so they change together.

**Files:**
- Modify: `src/hooks/useSettings.js:12`, `:44`
- Modify: `src/App.jsx` (destructure `:114-120`, shortcutHandlerRef `:721-722`, keydown `:740-744`, SettingsPanel props `:1116-1121`)
- Modify: `src/components/SettingsPanel.jsx` (props `:47-52`, the Clear row)
- Test: `src/components/SettingsPanel.test.jsx`
- Test: `src/hooks/useSettings.globalClear.test.jsx` → rename to `useSettings.clear.test.jsx`

- [ ] **Step 1: Update `useSettings.js`**

Change the import (line 12) from:
```js
import { useGlobalClearShortcut } from "./useGlobalClearShortcut.js";
```
to:
```js
import { useClearShortcut } from "./useClearShortcut.js";
```

Change the call (line 44) from:
```js
  const globalClear = useGlobalClearShortcut(onClearRef);
```
to:
```js
  const clearShortcutState = useClearShortcut(onClearRef);
```

Change the spread in the return object from `...globalClear,` to:
```js
    ...clearShortcutState,
```

- [ ] **Step 2: Update `App.jsx`**

(a) Destructuring from `useSettings` (lines 114-119) — replace the six `globalClear*` names with:
```jsx
    clearShortcut,
    setClearShortcut,
    clearGlobal,
    setClearGlobal,
    clearReady,
    registrationError,
```

(b) `shortcutHandlerRef` (line 722) — add `clearShortcut`:
```jsx
  shortcutHandlerRef.current = { onStartClick, clearAll, running, showClock, setSettingsOpen, clearShortcut };
```

(c) Import `eventMatchesAccelerator`. Find the existing import of accelerator helpers in App.jsx if present; otherwise add:
```jsx
import { eventMatchesAccelerator } from "./lib/accelerator.js";
```
(Place it with the other `./lib` imports.)

(d) keydown Clear branch — read `clearShortcut` from the ref and use the matcher. Change the destructure inside `onKeyDown` to include it, and replace the hardcoded `Ctrl+K` branch:

Replace:
```jsx
      const {
        onStartClick: start,
        clearAll: clear,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
      } = shortcutHandlerRef.current;
```
with:
```jsx
      const {
        onStartClick: start,
        clearAll: clear,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
        clearShortcut: clearCombo,
      } = shortcutHandlerRef.current;
```

Replace:
```jsx
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isRunning || hasClock) clear();
        return;
      }
```
with:
```jsx
      if (eventMatchesAccelerator(e, clearCombo)) {
        e.preventDefault();
        if (isRunning || hasClock) clear();
        return;
      }
```

(e) SettingsPanel props (lines 1116-1121) — replace the six `globalClear*` props with:
```jsx
          clearShortcut={clearShortcut}
          setClearShortcut={setClearShortcut}
          clearGlobal={clearGlobal}
          setClearGlobal={setClearGlobal}
          clearReady={clearReady}
          registrationError={registrationError}
```

- [ ] **Step 3: Update `SettingsPanel.jsx`**

(a) Props (lines 47-52) — replace the `globalClear*` props with:
```jsx
  clearShortcut = "CmdOrCtrl+K",
  setClearShortcut = () => {},
  clearGlobal = false,
  setClearGlobal = () => {},
  clearReady = false,
  registrationError = null,
```

(b) Replace the entire Clear row block (currently labelled "Global clear", the `<div className="flex items-center justify-between gap-2">` containing the Switch with `id="settings-global-clear"`, the ShortcutCapture, Reset, and the `registrationError` span) with:

```jsx
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="settings-clear">Clear</Label>
                      <ShortcutCapture
                        value={clearShortcut}
                        onChange={setClearShortcut}
                        isMac={isMac}
                        disabled={!clearReady}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!clearReady}
                        onClick={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                      >
                        Reset
                      </Button>
                      <Switch
                        id="settings-clear"
                        checked={clearGlobal}
                        onCheckedChange={setClearGlobal}
                        disabled={!clearReady}
                        className={cn(registrationError && "ring-2 ring-destructive")}
                      />
                    </div>
                  </div>
                  {registrationError ? (
                    <span className="text-xs text-destructive">Combo unavailable, try another</span>
                  ) : null}
```

(c) Update the default-import for the Reset default. Change:
```jsx
import { DEFAULT_GLOBAL_CLEAR_SHORTCUT } from "@/lib/globalClearPrefs.js";
```
to:
```jsx
import { DEFAULT_CLEAR_SHORTCUT } from "@/lib/clearShortcutPrefs.js";
```

- [ ] **Step 4: Update SettingsPanel test**

In `src/components/SettingsPanel.test.jsx`, replace the two global-clear cases with these (renamed labels/props, plus the error-state assertion):

```jsx
it("renders the keyboard shortcuts reference rows without a Clear read-only row", () => {
  render(<SettingsPanel {...BASE_PROPS} />);
  expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  expect(screen.getByText("Start / Stop")).toBeTruthy();
  expect(screen.getByText("Exit fullscreen")).toBeTruthy();
});

it("renders the editable Clear row with toggle and capture", () => {
  render(
    <SettingsPanel
      {...BASE_PROPS}
      clearGlobal={true}
      clearReady={true}
      clearShortcut="CmdOrCtrl+K"
    />
  );
  expect(screen.getByLabelText("Clear")).toBeTruthy();
  expect(screen.getByLabelText("Clear shortcut")).toBeTruthy();
});

it("shows the error state on the Clear toggle when registration failed", () => {
  render(
    <SettingsPanel
      {...BASE_PROPS}
      clearGlobal={true}
      clearReady={true}
      registrationError="HotKey already registered"
    />
  );
  expect(screen.getByText(/combo unavailable/i)).toBeTruthy();
  expect(screen.getByLabelText("Clear").className).toContain("ring-destructive");
});
```

- [ ] **Step 5: Rename the useSettings wiring test**

```bash
git mv src/hooks/useSettings.globalClear.test.jsx src/hooks/useSettings.clear.test.jsx
```

Replace its body's assertions with the renamed fields:

```jsx
describe("useSettings clear-shortcut wiring", () => {
  it("exposes clear-shortcut state with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.clearGlobal).toBe(false);
    expect(result.current.clearShortcut).toBe("CmdOrCtrl+K");
    expect(typeof result.current.setClearGlobal).toBe("function");
    expect(typeof result.current.setClearShortcut).toBe("function");
  });
});
```

(Keep the existing `beforeEach` matchMedia mock and imports in that file.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/SettingsPanel.test.jsx src/hooks/useSettings.clear.test.jsx`
Expected: PASS.

Then full suite: `npx vitest run`
Expected: PASS (the old `useGlobalClearShortcut` / `globalClearPrefs` tests still pass — those files are deleted in Task 6).

Then: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSettings.js src/App.jsx src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/hooks/useSettings.clear.test.jsx
git commit -m "feat(shortcut): unify clear into one customizable combo + global toggle"
```

---

### Task 6: Remove the superseded global-clear files

**Files:**
- Delete: `src/lib/globalClearPrefs.js`, `src/lib/globalClearPrefs.test.js`
- Delete: `src/hooks/useGlobalClearShortcut.js`, `src/hooks/useGlobalClearShortcut.test.jsx`

- [ ] **Step 1: Confirm nothing still imports them**

Run: `npx grep -rn "globalClearPrefs\|useGlobalClearShortcut\|DEFAULT_GLOBAL_CLEAR_SHORTCUT" src` (or use the Grep tool).
Expected: no matches outside the four files about to be deleted. If any other file matches, fix that reference first.

- [ ] **Step 2: Delete the files**

```bash
git rm src/lib/globalClearPrefs.js src/lib/globalClearPrefs.test.js src/hooks/useGlobalClearShortcut.js src/hooks/useGlobalClearShortcut.test.jsx
```

- [ ] **Step 3: Run full suite + lint**

Run: `npx vitest run`
Expected: PASS (no references to the deleted modules remain).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(shortcut): remove superseded global-clear module and hook"
```

---

### Task 7: Manual verification

No code — confirm end-to-end behavior unit tests cannot.

- [ ] **Step 1:** `npm run desktop` — app launches.
- [ ] **Step 2:** Open Settings → "Keyboard shortcuts". Confirm one continuous list, Start/Stop directly above the editable **Clear** row, no divider. Clear shows `Ctrl+K`.
- [ ] **Step 3:** With global toggle OFF, press `Ctrl+K` while PLVS is focused → clears. Rebind the combo (click the capture, press e.g. `Ctrl+Alt+C`) → pressing the new combo in-app clears.
- [ ] **Step 4:** Turn the global toggle ON. Switch to another app, press the combo → returning to PLVS shows it cleared.
- [ ] **Step 5:** Set the combo to one already held by another app (to force a failure if reproducible) → confirm the toggle shows the destructive ring + "Combo unavailable, try another", and in-app clear still works.
- [ ] **Step 6:** Toggle theme (plvs-dark ↔ plvs-light) while the error ring is showing → confirm the ring color follows the theme.
- [ ] **Step 7:** Quit and relaunch → combo + global state persist.

---

## Notes for the implementer

- Run from repo root `C:\Users\shenxichen\repos\PLVS`. `@/` maps to `src/`.
- `isTauri()` is false in Vitest; registration is inert unless mocked (Task 3 shows the pattern).
- The in-app keydown stays active regardless of the toggle — global registration is additive. Do not remove the window keydown listener.
- Keep existing in-app shortcuts (Space, `Ctrl+,`, digits, Esc) unchanged.
- `clearAll` is idempotent; do not add guards against double-fire.
