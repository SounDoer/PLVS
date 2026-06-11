# Unified Clear Shortcut

**Date:** 2026-06-11
**Status:** Approved

## Overview

Merge the two separate "Clear" shortcuts — the hardcoded in-app `Ctrl/Cmd+K` and the opt-in customizable global shortcut — into **one** customizable Clear shortcut with a single "works globally" toggle. One key, one mental model: the combo always clears in-app, and the toggle decides whether the *same* combo also fires when PLVS isn't focused.

This supersedes the global-clear design (`2026-06-11-global-clear-shortcut-design.md`), which shipped two distinct key combos for the same `clearAll` action.

## Motivation

The shipped feature exposed two different combos (`Ctrl+K` in-app, a separately-bound global combo) for the identical `clearAll` action. The user found maintaining two keys for one action redundant and wants a single Clear shortcut whose only variable is *scope* (in-app vs system-wide).

## Conceptual model

- **One combo** `clearShortcut` (customizable, default `CmdOrCtrl+K`).
- **One toggle** `clearGlobal` (default off) — "also works when PLVS isn't focused."
- The combo **always works in-app** (window keydown listener, now reading the customizable combo instead of a hardcoded `Ctrl+K`).
- When `clearGlobal` is on, the **same combo** is additionally registered system-wide via `tauri-plugin-global-shortcut`.
- The window keydown listener stays active regardless of the toggle, so in-app Clear works even if global registration fails. A registered OS hotkey is normally consumed by the OS even when PLVS is focused, so no double-fire; and `clearAll` is idempotent, so any overlap is harmless.

## UI Layout

The Settings "Keyboard shortcuts" section becomes one continuous list with no internal divider. The read-only rows are reordered so **Start / Stop sits directly above the editable Clear row**, which is the last row. The old read-only "Clear" row is removed (Clear is now the editable row).

```
Keyboard shortcuts
  Open settings                     Ctrl+,
  Fullscreen panel                  1 – 6
  Exit fullscreen                   Esc
  Start / Stop                      Space
  Clear   [Ctrl+K ✎]        Reset   [ global toggle ]
```

- The editable Clear row keeps the current layout idiom: label + combo capture on the left, `Reset` + toggle `Switch` on the right (toggle at the right edge, matching "Open at login").
- The combo capture (`ShortcutCapture`) is **always editable** once prefs are loaded — it governs the in-app shortcut, so it must be editable regardless of the global toggle. The toggle independently controls global scope. (This differs from the previous design, where the capture was gated on the global toggle being on.)

## Error handling

No proactive "this combo may clash" warning. The only surfaced error is a **real** registration failure: when `clearGlobal` is on and `register()` throws because the OS rejects the combo (already held — on Windows `RegisterHotKey` reports cross-app conflicts; on macOS cross-app detection is less reliable). On failure:

- The toggle **stays on** (the user's action is not reverted) but takes an **error state**: a destructive-colored ring on the `Switch` (`ring-2 ring-destructive`).
- An inline message "Combo unavailable, try another" (`text-destructive`) shows under the row.
- The error clears when the user changes the combo and the new one registers successfully (the registration effect re-runs and resets `registrationError`).
- In-app Clear keeps working throughout (window keydown is independent of registration).

**Theming (ADR 0002):** the error styling MUST use semantic tokens (`destructive`), never hardcoded colors or Tailwind `dark:` variants — the `eslint-plugin-plvs-adr-theme` rule enforces this. The `destructive` token is resolved per active theme via `data-theme` / `applyThemeToDocument`, so the error affordance follows the theme automatically (plvs-dark, plvs-light, and any future theme).

Accepted consequence: enabling global with a common combo like `Ctrl+K` will usually register successfully (no throw) and silently capture `Ctrl+K` system-wide — no error is shown. This is the user's explicit choice. Likewise, a "registered but not actually received" outcome (possible on macOS) produces no error; the only symptom is the key not clearing from another app.

## Data / persistence (plugin-store)

Keys in `plvs-settings.json` are renamed to match the new semantics (the shortcut is no longer "global-only"):

| Old key | New key | Default |
|---|---|---|
| `globalClearShortcut` | `clearShortcut` | `"CmdOrCtrl+K"` |
| `globalClearEnabled` | `clearGlobal` | `false` |

The old keys are simply no longer read (no migration). Any previously-saved value (e.g. a customized `Ctrl+Alt+Z`) is therefore reset to the new default `Ctrl+K` — intentional, since the concept changed. Old keys left orphaned in the store file are harmless.

## Architecture

### New / renamed files

**`src/lib/clearShortcutPrefs.js`** (renamed from `globalClearPrefs.js`)
- Exports `loadClearShortcutPrefs()`, `saveClearShortcutPrefs({ shortcut, global })`, `DEFAULT_CLEAR_SHORTCUT = "CmdOrCtrl+K"`.
- Same plugin-store / non-Tauri-fallback pattern as before; keys `clearShortcut` + `clearGlobal`.

**`src/hooks/useClearShortcut.js`** (renamed from `useGlobalClearShortcut.js`)
- Accepts the `onClearRef` (latest `clearAll`).
- Loads prefs on mount → `{ shortcut, global }`.
- Registers the combo globally **only when `global` is true**; unregisters when it goes false or the combo changes; unregisters on unmount. Sets `registrationError` on failure. (Logic unchanged from the prior hook except naming.)
- Returns `{ clearShortcut, clearGlobal, clearReady, registrationError, setClearShortcut, setClearGlobal }`.

### Modified files

**`src/lib/accelerator.js`**
- Add pure helper `eventMatchesAccelerator(e, accel)` → boolean, implemented as `keyEventToAccelerator(e) === accel`. Used by the in-app keydown to match the customizable combo.

**`src/data/keyboardShortcuts.js`**
- Remove the `clear` entry. Reorder so `startStop` is last:
```js
export const KEYBOARD_SHORTCUTS = [
  { id: "settings", label: "Open settings", keys: "CmdOrCtrl+," },
  { id: "fullscreen", label: "Fullscreen panel", keys: "1 – 6" },
  { id: "exitFullscreen", label: "Exit fullscreen", keys: "Escape" },
  { id: "startStop", label: "Start / Stop", keys: "Space" },
];
```

**`src/components/ShortcutCapture.jsx`**
- Import `DEFAULT_CLEAR_SHORTCUT` from the renamed prefs module (instead of `DEFAULT_GLOBAL_CLEAR_SHORTCUT`). Reset button uses it. The control is otherwise unchanged; its `disabled` prop is now driven only by `!clearReady` (always editable once loaded).
- Update the `aria-label` from `"Global clear shortcut"` to `"Clear shortcut"`.

**`src/components/SettingsPanel.jsx`**
- Rename props: `globalClearEnabled/globalClearShortcut/...` → `clearShortcut`, `setClearShortcut`, `clearGlobal`, `setClearGlobal`, `clearReady`, `registrationError`.
- Remove the `<Separator className="my-1" />` between the read-only list and the editable row.
- Row label "Global clear" → "Clear". Toggle controls `clearGlobal`; capture `disabled={!clearReady}`; Reset uses `DEFAULT_CLEAR_SHORTCUT`.
- When `registrationError` is set, the toggle `Switch` gets a conditional `ring-2 ring-destructive` (error state; stays on, not reverted). Use `cn(...)` to apply it conditionally.
- The read-only `.map` now renders the reordered list (Start/Stop last); the editable Clear row follows immediately, no divider.

**`src/hooks/useSettings.js`**
- Call the renamed `useClearShortcut(onClearRef)`; spread its values (now `clearShortcut`, `clearGlobal`, etc.) into the return object.

**`src/App.jsx`**
- The window keydown Clear branch changes from the hardcoded `(e.metaKey || e.ctrlKey) && e.key === "k"` to `eventMatchesAccelerator(e, clearShortcut)`, reading `clearShortcut` via `shortcutHandlerRef.current` (add `clearShortcut` to that ref alongside the existing handlers).
- Keep the existing gate `if (isRunning || hasClock) clear()`.
- `onClearRef.current = clearAll` stays (feeds the global handler).
- Forward the renamed props to `<SettingsPanel>`.

## Data flow

```
mount → loadClearShortcutPrefs() → { shortcut, global }
in-app keypress (window focused, keydown) → eventMatchesAccelerator(e, clearShortcut) → clearAll()
global on → register(clearShortcut, handler) → handler → onClearRef.current() === clearAll()
toggle global off → unregister
change combo → re-register if global on; in-app keydown picks up new combo immediately via ref
```

## Edge cases

| Scenario | Behavior |
|---|---|
| Default (fresh) | Combo `Ctrl+K`, global off → behaves like today's in-app Clear |
| Global on, combo registers fine | Combo clears both focused and unfocused |
| Global on, OS rejects combo | Inline "Combo unavailable, try another"; in-app keydown still clears |
| Common combo (`Ctrl+K`) + global on | Registers silently, captures system-wide; no warning (by design) |
| Combo changed while global on | Old unregistered, new registered; in-app match updates via ref |
| User sets combo colliding with another in-app shortcut (e.g. `Ctrl+,`) | Not specially handled (YAGNI); capture requires a modifier so bare-key collisions are excluded |
| Non-Tauri (browser dev) | No registration; combo still matched by window keydown; prefs return defaults |
| Restart | Combo + global state restored from plugin-store |

## Testing

- **`accelerator.test.js`** — add `eventMatchesAccelerator`: matches a correct event, rejects a wrong key/modifier, rejects a bare key (no modifier).
- **`clearShortcutPrefs.test.js`** (renamed) — defaults `{ shortcut: "CmdOrCtrl+K", global: false }` outside Tauri; save no-op outside Tauri; `DEFAULT_CLEAR_SHORTCUT` constant.
- **`useClearShortcut.test.jsx`** (renamed) — with mocks: registers when `global` true; routes handler to `onClearRef`; does NOT register when `global` false.
- **`SettingsPanel.test.jsx`** — list renders reordered (Start/Stop present, no "Clear" read-only row), editable Clear row present (`getByLabelText("Clear")` switch + `getByLabelText("Clear shortcut")` capture); no divider element between list and row; when `registrationError` is set, the switch carries the `ring-destructive` error class and the inline message renders.
- **`App.toolbar.test.js`** / keydown — pressing the configured combo triggers clear; pressing the old hardcoded behavior still works when combo is the default `Ctrl+K`.
- Full suite green; `npm run lint` clean.
