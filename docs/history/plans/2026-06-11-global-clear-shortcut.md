# Global Clear Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, customizable, system-wide keyboard shortcut that triggers `clearAll()` from anywhere, plus a keyboard-shortcuts reference list in Settings.

**Architecture:** A pure accelerator helper + a plugin-store prefs module + a `useGlobalClearShortcut` hook (modeled on `useAutostart`) own the registration lifecycle against `@tauri-apps/plugin-global-shortcut`. The Settings panel gains a "Keyboard shortcuts" section: read-only rows for existing shortcuts and one editable row (Switch + key-capture) for the global-clear binding. New prefs persist to plugin-store (`plvs-settings.json`); the binding defaults to `CmdOrCtrl+Alt+K`, disabled by default.

**Tech Stack:** React, Vitest + Testing Library (jsdom), Tauri v2 (`tauri-plugin-global-shortcut`, `tauri-plugin-store`).

Spec: `docs/superpowers/specs/2026-06-11-global-clear-shortcut-design.md`

---

## File Structure

- `src/lib/accelerator.js` (new) — pure helpers: build/validate/format accelerator strings.
- `src/lib/globalClearPrefs.js` (new) — plugin-store load/save for the two new keys.
- `src/data/keyboardShortcuts.js` (new) — static list of existing shortcuts for the reference UI.
- `src/hooks/useGlobalClearShortcut.js` (new) — registration lifecycle + state.
- `src/components/ShortcutCapture.jsx` (new) — editable key-capture control.
- `src/components/SettingsPanel.jsx` (modify) — render the new section.
- `src/hooks/useSettings.js` (modify) — wire the hook in.
- `src/App.jsx` (modify) — provide the `onClear` ref, forward props.
- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `package.json` (modify) — native plugin wiring.

---

### Task 1: Accelerator helpers (pure)

**Files:**
- Create: `src/lib/accelerator.js`
- Test: `src/lib/accelerator.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import {
  keyEventToAccelerator,
  isValidAccelerator,
  formatAcceleratorForDisplay,
} from "./accelerator.js";

describe("keyEventToAccelerator", () => {
  it("builds CmdOrCtrl from ctrl/meta plus letter", () => {
    expect(keyEventToAccelerator({ key: "k", ctrlKey: true })).toBe("CmdOrCtrl+K");
    expect(keyEventToAccelerator({ key: "k", metaKey: true })).toBe("CmdOrCtrl+K");
  });
  it("orders modifiers CmdOrCtrl, Alt, Shift", () => {
    expect(
      keyEventToAccelerator({ key: "z", ctrlKey: true, altKey: true, shiftKey: true })
    ).toBe("CmdOrCtrl+Alt+Shift+Z");
  });
  it("returns null without a modifier", () => {
    expect(keyEventToAccelerator({ key: "k" })).toBeNull();
  });
  it("returns null for a bare modifier key", () => {
    expect(keyEventToAccelerator({ key: "Control", ctrlKey: true })).toBeNull();
  });
  it("maps space to Space", () => {
    expect(keyEventToAccelerator({ key: " ", ctrlKey: true })).toBe("CmdOrCtrl+Space");
  });
});

describe("isValidAccelerator", () => {
  it("requires a modifier and exactly one key", () => {
    expect(isValidAccelerator("CmdOrCtrl+Alt+K")).toBe(true);
    expect(isValidAccelerator("Alt+Shift+Z")).toBe(true);
    expect(isValidAccelerator("K")).toBe(false);
    expect(isValidAccelerator("CmdOrCtrl")).toBe(false);
    expect(isValidAccelerator("")).toBe(false);
  });
});

describe("formatAcceleratorForDisplay", () => {
  it("uses glyphs on mac, words on windows", () => {
    expect(formatAcceleratorForDisplay("CmdOrCtrl+Alt+K", { isMac: true })).toBe("⌘⌥K");
    expect(formatAcceleratorForDisplay("CmdOrCtrl+Alt+K", { isMac: false })).toBe("Ctrl+Alt+K");
  });
  it("maps Escape to Esc and passes unknown tokens through", () => {
    expect(formatAcceleratorForDisplay("Escape", { isMac: false })).toBe("Esc");
    expect(formatAcceleratorForDisplay("Space", { isMac: true })).toBe("Space");
    expect(formatAcceleratorForDisplay("CmdOrCtrl+,", { isMac: false })).toBe("Ctrl+,");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/accelerator.test.js`
Expected: FAIL — cannot find module `./accelerator.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/accelerator.js
const MOD_ORDER = ["CmdOrCtrl", "Alt", "Shift"];
const BARE_MODIFIER_KEYS = ["Control", "Meta", "Alt", "Shift", "OS", "Dead"];
const DISPLAY_SPECIAL = { Escape: "Esc" };

/** Build a Tauri accelerator string from a KeyboardEvent-like object, or null if invalid. */
export function keyEventToAccelerator(e) {
  const key = e.key;
  if (typeof key !== "string" || BARE_MODIFIER_KEYS.includes(key)) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("CmdOrCtrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null;
  let main;
  if (key === " ") main = "Space";
  else if (key.length === 1) main = key.toUpperCase();
  else main = key;
  return [...mods, main].join("+");
}

export function isValidAccelerator(str) {
  if (typeof str !== "string" || !str.includes("+")) return false;
  const parts = str.split("+");
  const mods = parts.filter((p) => MOD_ORDER.includes(p));
  const keys = parts.filter((p) => !MOD_ORDER.includes(p));
  return mods.length >= 1 && keys.length === 1 && keys[0].length >= 1;
}

export function formatAcceleratorForDisplay(str, { isMac = false } = {}) {
  if (typeof str !== "string") return "";
  return str
    .split("+")
    .map((p) => {
      if (p === "CmdOrCtrl") return isMac ? "⌘" : "Ctrl";
      if (p === "Alt") return isMac ? "⌥" : "Alt";
      if (p === "Shift") return isMac ? "⇧" : "Shift";
      return DISPLAY_SPECIAL[p] || p;
    })
    .join(isMac ? "" : "+");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/accelerator.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/accelerator.js src/lib/accelerator.test.js
git commit -m "feat(shortcut): add accelerator build/validate/format helpers"
```

---

### Task 2: Global-clear prefs (plugin-store)

**Files:**
- Create: `src/lib/globalClearPrefs.js`
- Test: `src/lib/globalClearPrefs.test.js`

- [ ] **Step 1: Write the failing test**

The test runs in the default (non-Tauri) Vitest environment, so `isTauri()` is false and the module returns defaults without touching plugin-store.

```js
import { describe, expect, it } from "vitest";
import {
  loadGlobalClearPrefs,
  saveGlobalClearPrefs,
  DEFAULT_GLOBAL_CLEAR_SHORTCUT,
} from "./globalClearPrefs.js";

describe("globalClearPrefs (non-Tauri)", () => {
  it("default shortcut constant is CmdOrCtrl+Alt+K", () => {
    expect(DEFAULT_GLOBAL_CLEAR_SHORTCUT).toBe("CmdOrCtrl+Alt+K");
  });
  it("loads disabled + default shortcut when not in Tauri", async () => {
    await expect(loadGlobalClearPrefs()).resolves.toEqual({
      enabled: false,
      shortcut: "CmdOrCtrl+Alt+K",
    });
  });
  it("save is a no-op (resolves) outside Tauri", async () => {
    await expect(
      saveGlobalClearPrefs({ enabled: true, shortcut: "CmdOrCtrl+Alt+K" })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/globalClearPrefs.test.js`
Expected: FAIL — cannot find module `./globalClearPrefs.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/globalClearPrefs.js
import { isTauri } from "../ipc/env.js";

const STORE_FILE = "plvs-settings.json";
const ENABLED_KEY = "globalClearEnabled";
const SHORTCUT_KEY = "globalClearShortcut";

export const DEFAULT_GLOBAL_CLEAR_SHORTCUT = "CmdOrCtrl+Alt+K";

export async function loadGlobalClearPrefs() {
  const fallback = { enabled: false, shortcut: DEFAULT_GLOBAL_CLEAR_SHORTCUT };
  if (!isTauri()) return fallback;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const enabled = await store.get(ENABLED_KEY);
    const shortcut = await store.get(SHORTCUT_KEY);
    return {
      enabled: typeof enabled === "boolean" ? enabled : false,
      shortcut:
        typeof shortcut === "string" && shortcut ? shortcut : DEFAULT_GLOBAL_CLEAR_SHORTCUT,
    };
  } catch (_) {
    return fallback;
  }
}

export async function saveGlobalClearPrefs({ enabled, shortcut }) {
  if (!isTauri()) return;
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    await store.set(ENABLED_KEY, Boolean(enabled));
    await store.set(SHORTCUT_KEY, String(shortcut));
    await store.save();
  } catch (_) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/globalClearPrefs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/globalClearPrefs.js src/lib/globalClearPrefs.test.js
git commit -m "feat(shortcut): persist global-clear prefs to plugin-store"
```

---

### Task 3: Static keyboard-shortcuts list

**Files:**
- Create: `src/data/keyboardShortcuts.js`
- Test: `src/data/keyboardShortcuts.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS } from "./keyboardShortcuts.js";

describe("KEYBOARD_SHORTCUTS", () => {
  it("lists the five existing shortcuts in order", () => {
    expect(KEYBOARD_SHORTCUTS.map((s) => s.id)).toEqual([
      "startStop",
      "clear",
      "settings",
      "fullscreen",
      "exitFullscreen",
    ]);
  });
  it("each row has a label and keys", () => {
    for (const s of KEYBOARD_SHORTCUTS) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.keys).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/keyboardShortcuts.test.js`
Expected: FAIL — cannot find module `./keyboardShortcuts.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/data/keyboardShortcuts.js
/** Read-only reference list of the app's existing keyboard shortcuts. */
export const KEYBOARD_SHORTCUTS = [
  { id: "startStop", label: "Start / Stop", keys: "Space" },
  { id: "clear", label: "Clear", keys: "CmdOrCtrl+K" },
  { id: "settings", label: "Settings", keys: "CmdOrCtrl+," },
  { id: "fullscreen", label: "Fullscreen panel", keys: "1 – 6" },
  { id: "exitFullscreen", label: "Exit fullscreen", keys: "Escape" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/keyboardShortcuts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/keyboardShortcuts.js src/data/keyboardShortcuts.test.js
git commit -m "feat(shortcut): add static keyboard-shortcuts reference list"
```

---

### Task 4: Native plugin wiring (Rust + capabilities + deps)

No automated test — this task installs the plugin and registers it so the JS `register`/`unregister` IPC exists. Verification is a successful install and a Rust compile.

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:24` (plugin registration block)
- Modify: `src-tauri/capabilities/default.json` (permissions array)

- [ ] **Step 1: Add the JS dependency**

Run: `npm install @tauri-apps/plugin-global-shortcut@^2`
Expected: adds `"@tauri-apps/plugin-global-shortcut": "^2"` to `package.json` dependencies; install succeeds.

- [ ] **Step 2: Add the Rust dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` next to the other `tauri-plugin-*` lines, add:

```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 3: Register the plugin**

In `src-tauri/src/lib.rs`, next to the existing `.plugin(tauri_plugin_store::Builder::default().build())` line (around line 24), add:

```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

- [ ] **Step 4: Grant capabilities**

In `src-tauri/capabilities/default.json`, add these two entries to the `permissions` array (e.g. after `"store:default"`):

```json
"global-shortcut:allow-register",
"global-shortcut:allow-unregister"
```

- [ ] **Step 5: Verify the build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors (downloads the new crate on first run).

Also run: `npx vitest run` to confirm the new dependency did not break the JS test suite.
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "chore(shortcut): wire tauri-plugin-global-shortcut"
```

---

### Task 5: useGlobalClearShortcut hook

**Files:**
- Create: `src/hooks/useGlobalClearShortcut.js`
- Test: `src/hooks/useGlobalClearShortcut.test.jsx`

- [ ] **Step 1: Write the failing test**

The test mocks `isTauri` (true), the prefs module (enabled), and the plugin module, then asserts the hook registers the stored accelerator and that the registered handler calls the latest `onClear`.

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/globalClearPrefs.js", () => ({
  DEFAULT_GLOBAL_CLEAR_SHORTCUT: "CmdOrCtrl+Alt+K",
  loadGlobalClearPrefs: () =>
    Promise.resolve({ enabled: true, shortcut: "CmdOrCtrl+Alt+K" }),
  saveGlobalClearPrefs: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));

import { useGlobalClearShortcut } from "./useGlobalClearShortcut.js";

function Harness({ onClear }) {
  const ref = useRef(onClear);
  ref.current = onClear;
  useGlobalClearShortcut(ref);
  return null;
}

beforeEach(() => {
  register.mockReset();
  unregister.mockReset();
});

describe("useGlobalClearShortcut", () => {
  it("registers the stored accelerator and routes the handler to onClear", async () => {
    const onClear = vi.fn();
    render(<Harness onClear={onClear} />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toBe("CmdOrCtrl+Alt+K");

    const handler = register.mock.calls[0][1];
    handler({ state: "Pressed" });
    expect(onClear).toHaveBeenCalledTimes(1);

    handler({ state: "Released" });
    expect(onClear).toHaveBeenCalledTimes(1); // ignores non-press
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useGlobalClearShortcut.test.jsx`
Expected: FAIL — cannot find module `./useGlobalClearShortcut.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/hooks/useGlobalClearShortcut.js
import { useEffect, useRef, useState } from "react";
import { isTauri } from "../ipc/env.js";
import {
  loadGlobalClearPrefs,
  saveGlobalClearPrefs,
  DEFAULT_GLOBAL_CLEAR_SHORTCUT,
} from "../lib/globalClearPrefs.js";

/**
 * Owns the system-wide clear shortcut lifecycle.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useGlobalClearShortcut(onClearRef) {
  const [enabled, setEnabledState] = useState(false);
  const [shortcut, setShortcutState] = useState(DEFAULT_GLOBAL_CLEAR_SHORTCUT);
  const [ready, setReady] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const registeredRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadGlobalClearPrefs().then((prefs) => {
      if (!mounted) return;
      setEnabledState(prefs.enabled);
      setShortcutState(prefs.shortcut);
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
      if (!enabled) {
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
  }, [ready, enabled, shortcut, onClearRef]);

  useEffect(
    () => () => {
      const current = registeredRef.current;
      if (current && isTauri()) {
        import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) =>
          unregister(current).catch(() => {})
        );
      }
    },
    []
  );

  function setGlobalClearEnabled(next) {
    setEnabledState(next);
    void saveGlobalClearPrefs({ enabled: next, shortcut });
  }

  function setGlobalClearShortcut(next) {
    setShortcutState(next);
    void saveGlobalClearPrefs({ enabled, shortcut: next });
  }

  return {
    globalClearEnabled: enabled,
    globalClearShortcut: shortcut,
    globalClearReady: ready,
    registrationError,
    setGlobalClearEnabled,
    setGlobalClearShortcut,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useGlobalClearShortcut.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalClearShortcut.js src/hooks/useGlobalClearShortcut.test.jsx
git commit -m "feat(shortcut): add useGlobalClearShortcut registration hook"
```

---

### Task 6: ShortcutCapture control

**Files:**
- Create: `src/components/ShortcutCapture.jsx`
- Test: `src/components/ShortcutCapture.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutCapture } from "./ShortcutCapture.jsx";

describe("ShortcutCapture", () => {
  it("shows the formatted current value", () => {
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={vi.fn()} isMac={false} />);
    expect(screen.getByLabelText("Global clear shortcut").textContent).toBe("Ctrl+Alt+K");
  });

  it("captures a valid combo and calls onChange", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Global clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "j", ctrlKey: true, altKey: true });
    expect(onChange).toHaveBeenCalledWith("CmdOrCtrl+Alt+J");
  });

  it("rejects a combo with no modifier and shows a hint", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Global clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/needs a modifier/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ShortcutCapture.test.jsx`
Expected: FAIL — cannot find module `./ShortcutCapture.jsx`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// src/components/ShortcutCapture.jsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { keyEventToAccelerator, formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { DEFAULT_GLOBAL_CLEAR_SHORTCUT } from "@/lib/globalClearPrefs.js";

export function ShortcutCapture({ value, onChange, isMac = false, disabled = false }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = keyEventToAccelerator(e);
    if (!accel) {
      setHint("Needs a modifier (Ctrl/Alt/Shift)");
      return;
    }
    onChange(accel);
    setHint("");
    setRecording(false);
    e.currentTarget.blur();
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label="Global clear shortcut"
        className="font-mono"
        onClick={() => {
          setRecording(true);
          setHint("");
        }}
        onKeyDown={recording ? onKeyDown : undefined}
        onBlur={() => {
          setRecording(false);
          setHint("");
        }}
      >
        {recording ? "Press a combo…" : formatAcceleratorForDisplay(value, { isMac })}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onChange(DEFAULT_GLOBAL_CLEAR_SHORTCUT)}
      >
        Reset
      </Button>
      {hint ? <span className="text-xs text-destructive">{hint}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ShortcutCapture.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ShortcutCapture.jsx src/components/ShortcutCapture.test.jsx
git commit -m "feat(shortcut): add ShortcutCapture key-recording control"
```

---

### Task 7: Settings panel section

**Files:**
- Modify: `src/components/SettingsPanel.jsx` (props at lines 20-43; insert section after the system-behavior grid that closes at line 141)
- Test: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing test (append to existing file)**

Add inside the existing `describe("SettingsPanel", ...)` block:

```jsx
it("renders the keyboard shortcuts reference rows", () => {
  render(<SettingsPanel {...BASE_PROPS} />);
  expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  expect(screen.getByText("Start / Stop")).toBeTruthy();
  expect(screen.getByText("Exit fullscreen")).toBeTruthy();
});

it("renders the global-clear toggle and capture control", () => {
  render(
    <SettingsPanel
      {...BASE_PROPS}
      globalClearEnabled={true}
      globalClearReady={true}
      globalClearShortcut="CmdOrCtrl+Alt+K"
    />
  );
  expect(screen.getByLabelText("Global clear")).toBeTruthy();
  expect(screen.getByLabelText("Global clear shortcut")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — "Keyboard shortcuts" text not found.

- [ ] **Step 3: Add imports and props**

At the top of `src/components/SettingsPanel.jsx`, add imports below the existing `cn` import (line 16):

```jsx
import { ShortcutCapture } from "./ShortcutCapture.jsx";
import { KEYBOARD_SHORTCUTS } from "@/data/keyboardShortcuts.js";
import { formatAcceleratorForDisplay } from "@/lib/accelerator.js";
```

Add the new props to the destructured parameter list (after `setCloseAction = () => {},` at line 42):

```jsx
  globalClearEnabled = false,
  setGlobalClearEnabled = () => {},
  globalClearShortcut = "CmdOrCtrl+Alt+K",
  setGlobalClearShortcut = () => {},
  globalClearReady = false,
  registrationError = null,
```

Immediately after the destructuring (after `const reduceMotion = useReducedMotion();`, line 44), add:

```jsx
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");
```

- [ ] **Step 4: Insert the section markup**

In `src/components/SettingsPanel.jsx`, the system-behavior grid `</div>` is at line 141, immediately followed by `<Separator />` (line 142) before the Appearance block. Insert this block **between** line 141 and the existing line-142 `<Separator />`:

```jsx
                <Separator />
                <div className="grid gap-2">
                  <Label>Keyboard shortcuts</Label>
                  <div className="grid gap-1.5 text-muted-foreground">
                    {KEYBOARD_SHORTCUTS.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2">
                        <span>{s.label}</span>
                        <span className="font-mono tabular-nums">
                          {formatAcceleratorForDisplay(s.keys, { isMac })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Separator className="my-1" />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="settings-global-clear"
                        checked={globalClearEnabled}
                        onCheckedChange={setGlobalClearEnabled}
                        disabled={!globalClearReady}
                      />
                      <Label htmlFor="settings-global-clear">Global clear</Label>
                    </div>
                    <ShortcutCapture
                      value={globalClearShortcut}
                      onChange={setGlobalClearShortcut}
                      isMac={isMac}
                      disabled={!globalClearEnabled || !globalClearReady}
                    />
                  </div>
                  {registrationError ? (
                    <span className="text-xs text-destructive">
                      Combo unavailable, try another
                    </span>
                  ) : null}
                </div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS (new cases + existing cases still green).

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(shortcut): add keyboard shortcuts section to Settings"
```

---

### Task 8: Wire hook into useSettings and App

**Files:**
- Modify: `src/hooks/useSettings.js` (signature line 20; return object lines 108-127)
- Modify: `src/App.jsx` (useSettings call line 113; clearAll line 639; SettingsPanel props lines 1085-1108)

- [ ] **Step 1: Write the failing test**

Add a new test file asserting `useSettings` exposes the global-clear fields with defaults (non-Tauri path → ready false, disabled).

`src/hooks/useSettings.globalClear.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSettings } from "./useSettings.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("useSettings global-clear wiring", () => {
  it("exposes global-clear state with safe defaults outside Tauri", () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.globalClearEnabled).toBe(false);
    expect(result.current.globalClearShortcut).toBe("CmdOrCtrl+Alt+K");
    expect(typeof result.current.setGlobalClearEnabled).toBe("function");
    expect(typeof result.current.setGlobalClearShortcut).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useSettings.globalClear.test.jsx`
Expected: FAIL — `globalClearEnabled` is undefined.

- [ ] **Step 3: Wire the hook into useSettings**

In `src/hooks/useSettings.js`:

Add the import below the `useAutostart` import (line 11):

```js
import { useGlobalClearShortcut } from "./useGlobalClearShortcut.js";
```

Change the signature (line 20) to accept the optional ref:

```js
export function useSettings({ onClearRef } = {}) {
```

After the `useAutostart()` call (line 42), add:

```js
  const globalClear = useGlobalClearShortcut(onClearRef);
```

In the returned object (before the closing `};` at line 127), spread the hook's values:

```js
    ...globalClear,
```

- [ ] **Step 4: Wire the ref and props in App**

In `src/App.jsx`:

Before the `useSettings(...)` destructuring (line 113), create the ref:

```jsx
  const onClearRef = useRef(null);
```

Change the `useSettings()` call to pass the ref and destructure the new fields. Add to the destructured list:

```jsx
    globalClearEnabled,
    setGlobalClearEnabled,
    globalClearShortcut,
    setGlobalClearShortcut,
    globalClearReady,
    registrationError,
```

and change the call itself to:

```jsx
  } = useSettings({ onClearRef });
```

After the `clearAll` definition (the function ends at line 685 with `setShowClock(running); };`), add:

```jsx
  onClearRef.current = clearAll;
```

In the `<SettingsPanel ... />` props (after `setCloseAction={setCloseAction}` at line 1107), add:

```jsx
          globalClearEnabled={globalClearEnabled}
          setGlobalClearEnabled={setGlobalClearEnabled}
          globalClearShortcut={globalClearShortcut}
          setGlobalClearShortcut={setGlobalClearShortcut}
          globalClearReady={globalClearReady}
          registrationError={registrationError}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useSettings.globalClear.test.jsx src/App.toolbar.test.js`
Expected: PASS (new wiring test green; existing App test still green).

- [ ] **Step 6: Full check**

Run: `npx vitest run`
Expected: entire suite passes.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSettings.js src/App.jsx src/hooks/useSettings.globalClear.test.jsx
git commit -m "feat(shortcut): wire global-clear shortcut into Settings and App"
```

---

### Task 9: Manual verification in the desktop app

No code — confirm the end-to-end behavior the unit tests cannot.

- [ ] **Step 1: Launch the desktop app**

Run: `npm run desktop`
Expected: PLVS window opens.

- [ ] **Step 2: Enable and bind**

Open Settings (`Ctrl/Cmd+,`) → "Keyboard shortcuts" section. Toggle **Global clear** on. Confirm the capture button shows `Ctrl+Alt+K` (or `⌘⌥K` on macOS). Optionally click it and record a different combo.

- [ ] **Step 3: Trigger from another app**

Start monitoring, let some audio play so meters/history populate. Switch focus to another window. Press the bound combo. Return to PLVS and confirm history/peak-hold/meters were cleared.

- [ ] **Step 4: Disable**

Toggle Global clear off. Press the combo from another app. Confirm nothing clears.

- [ ] **Step 5: Persistence**

Quit and relaunch PLVS. Confirm the toggle state and combo persisted (read back from `plvs-settings.json`).

---

## Notes for the implementer

- **Run from the repo root** (`C:\Users\shenxichen\repos\PLVS`). The `@/` alias maps to `src/` (see `jsconfig.json` / Vite config).
- **`isTauri()` is false in Vitest**, so prefs and registration are inert in tests unless explicitly mocked (Task 5 shows the pattern).
- **Do not change** the existing in-app shortcuts (Space / `Ctrl+K` / `Ctrl+,` in `App.jsx`, digit/Esc in `SplitLayout.jsx`). The global shortcut is additive.
- **Default stays disabled.** Nothing is registered until the user opts in.
