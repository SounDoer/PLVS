# System Behavior Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Open at login" (Toggle Switch) and "Close behavior" (Select) to a new system section at the top of the Settings panel.

**Architecture:** `tauri-plugin-autostart` is registered in the Rust backend and exposes IPC commands directly; the frontend calls these via a new `useAutostart` hook. `closeAction` state lives in `useSettings`, reading/writing the existing `plvs:closeAction` localStorage key shared with `useCloseConfirm`. Both new settings are passed from App.jsx to SettingsPanel as props.

**Tech Stack:** Tauri v2, `tauri-plugin-autostart`, `@radix-ui/react-switch`, React hooks, Vitest + Testing Library

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src-tauri/Cargo.toml` | Add autostart crate |
| Modify | `src-tauri/src/lib.rs` | Register autostart plugin |
| Modify | `src-tauri/capabilities/default.json` | Grant autostart permissions to frontend |
| Create | `src/components/ui/switch.jsx` | shadcn Switch primitive |
| Create | `src/hooks/useAutostart.js` | Read/write OS autostart state via plugin IPC |
| Create | `src/hooks/useAutostart.test.js` | Unit tests for useAutostart |
| Modify | `src/hooks/useSettings.js` | Add `closeAction`/`setCloseAction`, integrate `useAutostart` |
| Modify | `src/hooks/useSettings.rtl.test.jsx` | Tests for new closeAction behavior |
| Modify | `src/components/SettingsPanel.jsx` | New system section with Switch + Select |
| Modify | `src/components/SettingsPanel.test.jsx` | Tests for new controls |
| Modify | `src/App.jsx` | Destructure new values, pass to SettingsPanel |

---

## Task 1: Rust backend — register tauri-plugin-autostart

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add dependency to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `tauri-plugin-process` line:

```toml
tauri-plugin-autostart = "2"
```

- [ ] **Step 2: Register plugin in lib.rs**

In `src-tauri/src/lib.rs`, add the autostart plugin after the existing plugins (before `.manage(...)`):

```rust
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .manage(AppState::default())
    // ...rest unchanged
```

- [ ] **Step 3: Add capabilities permissions**

In `src-tauri/capabilities/default.json`, add three entries to the `"permissions"` array:

```json
"autostart:allow-enable",
"autostart:allow-disable",
"autostart:allow-is-enabled"
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors. (Warnings are OK.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(backend): register tauri-plugin-autostart"
```

---

## Task 2: Install @radix-ui/react-switch and create Switch component

**Files:**
- Create: `src/components/ui/switch.jsx`

- [ ] **Step 1: Install the Radix primitive**

```bash
npm install @radix-ui/react-switch
```

Expected: package added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Create `src/components/ui/switch.jsx`**

```jsx
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
});

export { Switch };
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/switch.jsx package.json package-lock.json
git commit -m "feat(ui): add Switch component"
```

---

## Task 3: useAutostart hook + tests

**Files:**
- Create: `src/hooks/useAutostart.js`
- Create: `src/hooks/useAutostart.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useAutostart.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../ipc/env.js", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { isTauri } from "../ipc/env.js";
import { invoke } from "@tauri-apps/api/core";
import { useAutostart } from "./useAutostart.js";

describe("useAutostart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauri.mockReturnValue(false);
  });

  it("is not ready and disabled in non-Tauri environment", () => {
    const { result } = renderHook(() => useAutostart());
    expect(result.current.autostartReady).toBe(false);
    expect(result.current.autostartEnabled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads current autostart state on mount in Tauri environment", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    expect(result.current.autostartEnabled).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|is_enabled");
  });

  it("calls enable command and updates state when toggled on", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValueOnce(false); // is_enabled → false
    invoke.mockResolvedValue(undefined); // enable → void
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    await act(async () => { await result.current.setAutostartEnabled(true); });
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|enable");
    expect(result.current.autostartEnabled).toBe(true);
  });

  it("calls disable command and updates state when toggled off", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValueOnce(true); // is_enabled → true
    invoke.mockResolvedValue(undefined); // disable → void
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    await act(async () => { await result.current.setAutostartEnabled(false); });
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|disable");
    expect(result.current.autostartEnabled).toBe(false);
  });

  it("stays not ready when is_enabled call rejects", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("unavailable"));
    const { result } = renderHook(() => useAutostart());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.autostartReady).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- src/hooks/useAutostart.test.js
```

Expected: FAIL — `useAutostart.js` does not exist yet.

- [ ] **Step 3: Create `src/hooks/useAutostart.js`**

```js
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export function useAutostart() {
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [autostartReady, setAutostartReady] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    invoke("plugin:autostart|is_enabled")
      .then((enabled) => {
        setAutostartEnabledState(enabled);
        setAutostartReady(true);
      })
      .catch(() => {
        setAutostartReady(false);
      });
  }, []);

  async function setAutostartEnabled(enabled) {
    if (!isTauri()) return;
    try {
      await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
      setAutostartEnabledState(enabled);
    } catch (_) {}
  }

  return { autostartEnabled, setAutostartEnabled, autostartReady };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- src/hooks/useAutostart.test.js
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAutostart.js src/hooks/useAutostart.test.js
git commit -m "feat(hooks): add useAutostart hook"
```

---

## Task 4: Add closeAction to useSettings

**Files:**
- Modify: `src/hooks/useSettings.js`
- Modify: `src/hooks/useSettings.rtl.test.jsx`

- [ ] **Step 1: Add failing tests to `src/hooks/useSettings.rtl.test.jsx`**

Append these four test cases inside the existing `describe("useSettings", ...)` block:

```js
  it("defaults closeAction to 'ask' when localStorage key is absent", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    expect(result.current.closeAction).toBe("ask");
  });

  it("reads closeAction from localStorage on mount", () => {
    localStorage.setItem("plvs:closeAction", "tray");
    const { result } = renderHook(() => useSettings());
    expect(result.current.closeAction).toBe("tray");
  });

  it("setCloseAction to 'tray' writes to localStorage and updates state", () => {
    localStorage.clear();
    const { result } = renderHook(() => useSettings());
    act(() => { result.current.setCloseAction("tray"); });
    expect(localStorage.getItem("plvs:closeAction")).toBe("tray");
    expect(result.current.closeAction).toBe("tray");
  });

  it("setCloseAction to 'ask' removes the key from localStorage", () => {
    localStorage.setItem("plvs:closeAction", "quit");
    const { result } = renderHook(() => useSettings());
    act(() => { result.current.setCloseAction("ask"); });
    expect(localStorage.getItem("plvs:closeAction")).toBeNull();
    expect(result.current.closeAction).toBe("ask");
  });
```

- [ ] **Step 2: Run tests — expect the new cases to fail**

```bash
npm test -- src/hooks/useSettings.rtl.test.jsx
```

Expected: 4 new cases FAIL — `closeAction` not yet in useSettings.

- [ ] **Step 3: Update `src/hooks/useSettings.js`**

Add the `CLOSE_ACTION_KEY` constant and the `closeAction` state immediately below the existing `referenceLufs` state, and integrate `useAutostart`. The full updated file:

```js
import { useEffect, useMemo, useState } from "react";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
import { getBuiltinTheme, isThemeId, THEME_SELECT_OPTIONS } from "../theme/builtinThemes.js";
import { useAutostart } from "./useAutostart.js";

const CLOSE_ACTION_KEY = "plvs:closeAction";

function normalizeReferenceLufs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : -23;
}

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState(
    () => readPersistedShellThemeFields(UI_PREFERENCES).appearance
  );
  const [themeId, setThemeId] = useState(
    () => readPersistedShellThemeFields(UI_PREFERENCES).themeId
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceLufs, setReferenceLufs] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return -23;
      const s = JSON.parse(raw);
      return normalizeReferenceLufs(s.referenceLufs);
    } catch (_) {}
    return -23;
  });
  const [closeAction, setCloseActionState] = useState(
    () => localStorage.getItem(CLOSE_ACTION_KEY) ?? "ask"
  );

  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark),
    [appearance, themeId, systemPrefersDark]
  );
  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);

  /** ADR 0002 §6: switching system → fixed seeds `themeId` from the resolved builtin at that moment. */
  function setAppearanceMode(mode) {
    if (mode === "system") {
      setAppearance("system");
      setThemeId(null);
      return;
    }
    if (appearance === "system") {
      setThemeId(resolveThemeId({ appearance: "system", themeId: null }, systemPrefersDark));
    }
    setAppearance("fixed");
  }

  function setFixedThemeIdFromPicker(id) {
    if (!isThemeId(id)) return;
    setAppearance("fixed");
    setThemeId(id);
  }

  const fixedThemeSelectValue = useMemo(() => {
    if (appearance !== "fixed") return "";
    return isThemeId(themeId) ? themeId : resolvedThemeId;
  }, [appearance, themeId, resolvedThemeId]);

  function setCloseAction(value) {
    if (value === "ask") {
      localStorage.removeItem(CLOSE_ACTION_KEY);
    } else {
      localStorage.setItem(CLOSE_ACTION_KEY, value);
    }
    setCloseActionState(value);
  }

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyLayoutToDocument(UI_PREFERENCES, { colorScheme: resolvedTheme.colorScheme });
    applyThemeToDocument(resolvedThemeId);
  }, [resolvedThemeId, resolvedTheme.colorScheme]);

  useEffect(() => {
    const key = UI_PREFERENCES.layoutPersistKey;
    const onStorage = (e) => {
      if (e.key !== key && e.key !== null) return;
      const next = readPersistedShellThemeFields(UI_PREFERENCES);
      setAppearance(next.appearance);
      setThemeId(next.themeId);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearance,
    themeId,
    setThemeId,
    resolvedThemeId,
    themeSelectOptions: THEME_SELECT_OPTIONS,
    setAppearanceMode,
    setFixedThemeIdFromPicker,
    fixedThemeSelectValue,
    referenceLufs,
    setReferenceLufs,
    closeAction,
    setCloseAction,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
  };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npm test -- src/hooks/useSettings.rtl.test.jsx
```

Expected: all 9 tests PASS (5 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSettings.js src/hooks/useSettings.rtl.test.jsx
git commit -m "feat(hooks): add closeAction and autostart state to useSettings"
```

---

## Task 5: Update SettingsPanel UI + tests

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Add failing tests to `SettingsPanel.test.jsx`**

Add this import at the top of the test file:

```js
import { act } from "@testing-library/react";
```

Append these test cases inside the existing `describe("SettingsPanel", ...)` block:

```js
  const SYSTEM_PROPS = {
    autostartEnabled: false,
    setAutostartEnabled: vi.fn(),
    autostartReady: false,
    closeAction: "ask",
    setCloseAction: vi.fn(),
  };

  it("renders Open at login switch disabled when autostartReady is false", () => {
    render(<SettingsPanel {...BASE_PROPS} {...SYSTEM_PROPS} />);
    const toggle = screen.getByRole("switch", { name: /open at login/i });
    expect(toggle).toBeTruthy();
    expect(toggle).toBeDisabled();
  });

  it("renders Open at login switch checked when autostartEnabled is true", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...SYSTEM_PROPS}
        autostartEnabled={true}
        autostartReady={true}
      />
    );
    const toggle = screen.getByRole("switch", { name: /open at login/i });
    expect(toggle.getAttribute("data-state")).toBe("checked");
    expect(toggle).not.toBeDisabled();
  });

  it("renders Close behavior select with current value", () => {
    render(<SettingsPanel {...BASE_PROPS} {...SYSTEM_PROPS} closeAction="tray" />);
    expect(screen.getByLabelText("Close behavior")).toBeTruthy();
  });

  it("existing controls still render with new props absent (backwards compat)", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText("Loudness reference")).toBeTruthy();
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests — expect new cases to fail**

```bash
npm test -- src/components/SettingsPanel.test.jsx
```

Expected: 4 new cases FAIL — Switch and Close behavior controls not in SettingsPanel yet.

- [ ] **Step 3: Update `src/components/SettingsPanel.jsx`**

Add `Switch` to imports and add the new props with defaults. The complete updated file:

```jsx
import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases";

export function SettingsPanel({
  settingsOpen,
  setSettingsOpen,
  appearance,
  setAppearanceMode,
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  themeSelectOptions,
  referenceLufs,
  setReferenceLufs,
  channelLayout,
  setChannelLayout,
  appVersion,
  latestVersion,
  releaseUrl,
  hasUpdate = false,
  updateStatus = latestVersion ? "ok" : "checking",
  openReleaseUrl = () => {},
  autostartEnabled = false,
  setAutostartEnabled = () => {},
  autostartReady = false,
  closeAction = "ask",
  setCloseAction = () => {},
}) {
  const reduceMotion = useReducedMotion();
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const closingIntentRef = useRef(false);
  const effectiveReleaseUrl = releaseUrl || RELEASES_URL;
  const updateStatusText = latestVersion
    ? hasUpdate
      ? `Update available: v${latestVersion}`
      : "Up to date"
    : updateStatus === "unavailable"
      ? "Update check unavailable"
      : "Checking updates";

  useLayoutEffect(() => {
    if (settingsOpen) {
      closingIntentRef.current = false;
      setSheetBodyVisible(true);
      return;
    }
    if (!closingIntentRef.current) {
      setSheetBodyVisible(false);
    }
  }, [settingsOpen]);

  const handleOpenChange = (open) => {
    if (open) {
      closingIntentRef.current = false;
      setSettingsOpen(true);
      setSheetBodyVisible(true);
      return;
    }
    closingIntentRef.current = true;
    setSheetBodyVisible(false);
  };

  return (
    <Sheet open={settingsOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className={cn(
          "w-full gap-0 overflow-y-auto border-border bg-card/95 p-6 backdrop-blur-md sm:max-w-md",
          "pt-12"
        )}
      >
        <AnimatePresence
          onExitComplete={() => {
            if (closingIntentRef.current) {
              closingIntentRef.current = false;
              setSettingsOpen(false);
            }
          }}
        >
          {sheetBodyVisible ? (
            <motion.div
              key="settings-inner"
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 0, x: 14, transition: { duration: 0.12, ease: "easeIn" } }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 36, mass: 0.35 }
              }
            >
              <SheetHeader className="mb-[var(--ui-modal-header-gap)] space-y-0 p-0 pr-10 text-left">
                <SheetTitle className="text-[length:var(--ui-fs-panel-title)] font-semibold text-muted-foreground">
                  Settings
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-5 text-[length:var(--ui-fs-metric-meta)]">
                <div className="grid gap-5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="settings-open-at-login">Open at login</Label>
                    <Switch
                      id="settings-open-at-login"
                      checked={autostartEnabled}
                      onCheckedChange={setAutostartEnabled}
                      disabled={!autostartReady}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="settings-close-action">Close behavior</Label>
                    <Select value={closeAction} onValueChange={setCloseAction}>
                      <SelectTrigger id="settings-close-action">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="ask">Ask each time</SelectItem>
                        <SelectItem value="tray">Minimize to tray</SelectItem>
                        <SelectItem value="quit">Quit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-appearance">Appearance</Label>
                  <Select value={appearance} onValueChange={setAppearanceMode}>
                    <SelectTrigger id="settings-appearance">
                      <SelectValue placeholder="Appearance" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="fixed">Fixed theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appearance === "fixed" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="settings-theme-id">Colour theme</Label>
                    <Select value={fixedThemeSelectValue} onValueChange={setFixedThemeIdFromPicker}>
                      <SelectTrigger id="settings-theme-id">
                        <SelectValue placeholder="Theme" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {themeSelectOptions.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-ref-lufs">Loudness reference</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="settings-ref-lufs"
                      type="number"
                      min={-70}
                      max={0}
                      step={1}
                      value={referenceLufs}
                      onChange={(e) => {
                        if (e.target.value === "") return;
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= -70 && n <= 0) setReferenceLufs(n);
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground shrink-0">LUFS</span>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-channel-layout">Channel layout</Label>
                  <Select value={channelLayout} onValueChange={setChannelLayout}>
                    <SelectTrigger id="settings-channel-layout">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="stereo">Stereo</SelectItem>
                      <SelectItem value="5.1">5.1</SelectItem>
                      <SelectItem value="7.1">7.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appVersion ? (
                  <>
                    <Separator />
                    <div className="flex items-center justify-end text-muted-foreground">
                      <div className="flex min-w-0 items-center justify-end gap-1.5 text-xs">
                        <span className="font-mono tabular-nums text-muted-foreground">
                          v{appVersion}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className={hasUpdate ? "text-primary" : "text-muted-foreground"}>
                          {updateStatusText}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-auto gap-1 px-0 py-0 text-xs hover:bg-transparent",
                            hasUpdate
                              ? "text-primary hover:text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => openReleaseUrl(effectiveReleaseUrl)}
                        >
                          {hasUpdate ? "View release" : "View releases"}
                          <ExternalLink className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npm test -- src/components/SettingsPanel.test.jsx
```

Expected: all tests PASS (existing + 4 new).

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(ui): add Open at login and Close behavior to SettingsPanel"
```

---

## Task 6: Wire up in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Destructure new values from useSettings in AppContent**

In `src/App.jsx`, find the `useSettings()` destructuring (around line 97) and add the new fields:

```js
  const {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearanceMode,
    fixedThemeSelectValue,
    setFixedThemeIdFromPicker,
    themeSelectOptions,
    resolvedThemeId,
    referenceLufs,
    setReferenceLufs,
    closeAction,
    setCloseAction,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
  } = useSettings();
```

- [ ] **Step 2: Pass new props to SettingsPanel**

Find the `<SettingsPanel ... />` JSX block (around line 1080) and add the five new props:

```jsx
        <SettingsPanel
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          appearance={appearance}
          setAppearanceMode={setAppearanceMode}
          fixedThemeSelectValue={fixedThemeSelectValue}
          setFixedThemeIdFromPicker={setFixedThemeIdFromPicker}
          themeSelectOptions={themeSelectOptions}
          referenceLufs={referenceLufs}
          setReferenceLufs={setReferenceLufs}
          channelLayout={channelLayout}
          setChannelLayout={setChannelLayout}
          appVersion={APP_VERSION}
          latestVersion={updateInfo?.latestVersion}
          releaseUrl={updateInfo?.releaseUrl}
          hasUpdate={updateInfo?.hasUpdate}
          updateStatus={updateInfo?.status}
          openReleaseUrl={openExternalUrl}
          autostartEnabled={autostartEnabled}
          setAutostartEnabled={setAutostartEnabled}
          autostartReady={autostartReady}
          closeAction={closeAction}
          setCloseAction={setCloseAction}
        />
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): wire autostart and closeAction through App → SettingsPanel"
```
