# Global Clear Shortcut

**Date:** 2026-06-11
**Status:** Approved

## Overview

Add a **system-wide, customizable, opt-in keyboard shortcut** that triggers Clear from anywhere — without focusing the PLVS window. Because PLVS lives on the desktop permanently and keeps running through silence, starting a new video today means switching focus to PLVS and pressing Clear. A global shortcut collapses that to a single keypress from any app.

A companion change adds a **Keyboard shortcuts reference list** to the Settings panel, since none of PLVS's existing keyboard shortcuts are currently surfaced anywhere in the UI.

## Motivation

- PLVS runs continuously; stale history from the previous source persists until the user manually clears. The only clear affordances (the toolbar button and in-app `Ctrl/Cmd+K`) require the PLVS window to be focused.
- A global shortcut is deterministic and tuning-free — unlike a silence-gated auto-clear heuristic, it never fires at the wrong moment and needs no threshold to guess.
- Global shortcuts are registered system-wide and can collide with the OS or other apps, so the binding **must** be user-customizable and **must** be possible to disable entirely.
- PLVS already has five keyboard shortcuts that no UI exposes (the project author was unaware of them). The reference list closes that discoverability gap and is the natural home for the editable global-clear binding.

## Scope

Two parts, the second riding along with the first:

1. **Global Clear shortcut** (primary) — opt-in, customizable, with on/off toggle.
2. **Keyboard shortcuts reference list** in Settings (companion) — read-only rows for the existing shortcuts plus one editable row for the global-clear binding.

**Explicitly out of scope:** migrating existing `localStorage` settings to plugin-store (a separate, deliberate cleanup — see Persistence note), and any silence-detection / audio-source / auto-segmenting mechanism (rejected in favor of the deterministic shortcut).

## Decisions

| Question | Decision |
|---|---|
| Mechanism | Global OS shortcut bound to the existing `clearAll()`, not a heuristic |
| Default state | **Off** — opt-in; nothing registered until the user enables it |
| Customizable | Yes — editable combo + enable/disable toggle |
| Default combo (when first enabled) | `CmdOrCtrl+Alt+K` (two-modifier, deliberately uncommon to reduce system-wide collisions) |
| Feedback on trigger | **None** — clears silently; the window may be hidden, and silence is the point |
| Persistence | plugin-store (`plvs-settings.json`), **not** localStorage |
| Shortcut discoverability | A reference list in Settings (the global-clear binding is the one editable row) |

## Persistence: why plugin-store for the new keys

PLVS currently has **two** persistence mechanisms, and the codebase is mid-migration from the first toward the second:

- `localStorage` (webview, synchronous) — most UI settings: theme, layout, `referenceLufs`, `closeAction`.
- `tauri-plugin-store` (`plvs-settings.json` on disk, async, readable from Rust + JS) — currently only `captureDeviceId`, migrated off a legacy localStorage key (see `src/ipc/capturePrefs.js`).

The new keys go to **plugin-store**:

- The global-shortcut registration flow is already async (register after load), so plugin-store's async `Store.load` adds no UI flash and no extra ceremony beyond what the feature already needs.
- plugin-store is the codebase's target for durable user settings; new code should not add fresh debt to the legacy localStorage store.

This is **not** a call to migrate everything to plugin-store. localStorage's synchronous read is valuable for first-paint-critical state (theme/layout would flash if moved to an async store). The right end state is a deliberate split — durable settings in plugin-store, first-paint visual state in localStorage — not "everything in plugin-store." That cleanup is tracked separately and is not part of this feature.

## UI Layout

A new "Keyboard shortcuts" section is added to the Settings panel, below the existing system-behavior section, separated by a `Separator`:

```
Open at login        [Switch]
Close behavior       [Select]
──────────────────────────────────────────────
Keyboard shortcuts
  Start / Stop                       Space
  Clear                              ⌘/Ctrl K
  Settings                           ⌘/Ctrl ,
  Fullscreen panel                   1 – 6
  Exit fullscreen                    Esc
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Global clear        [Switch]   [ ⌘/Ctrl ⌥ K  ✎ ]   ← editable, opt-in
──────────────────────────────────────────────
Appearance           [Select]
... existing settings
```

- The five existing shortcuts render as **read-only** rows (label + key hint).
- The **Global clear** row carries the enable `Switch` and an editable key-capture control.
- Modifier glyphs are platform-aware (`⌘`/`⌥` on macOS, `Ctrl`/`Alt` on Windows).

## Architecture

### New files

**`src/lib/accelerator.js`** — pure, unit-tested helpers (no React, no Tauri):
- `keyEventToAccelerator(e)` → accelerator string (e.g. `"CmdOrCtrl+Alt+K"`) or `null` if the combo is invalid (no modifier, or a bare modifier key).
- `isValidAccelerator(str)` → boolean. Requires at least one modifier plus a non-modifier key.
- `formatAcceleratorForDisplay(str, { isMac })` → human glyph string (`"⌘⌥K"` / `"Ctrl+Alt+K"`).

**`src/lib/globalClearPrefs.js`** — plugin-store read/write for the two new keys, mirroring `capturePrefs.js`:
- Reuses `STORE_FILE = "plvs-settings.json"`.
- Keys: `globalClearEnabled` (bool, default `false`), `globalClearShortcut` (string, default `"CmdOrCtrl+Alt+K"`).
- `loadGlobalClearPrefs()` → `Promise<{ enabled, shortcut }>` with defaults when unset or in non-Tauri.
- `saveGlobalClearPrefs({ enabled, shortcut })` → `Promise<void>`.

**`src/hooks/useGlobalClearShortcut.js`** — owns registration lifecycle, modeled on `useAutostart.js`:
- Accepts a stable `onClear` ref (the handler must call the current `clearAll`; see Data flow).
- On mount: `loadGlobalClearPrefs()` → state `{ enabled, shortcut }`; if `enabled` and Tauri, register.
- Exposes `{ globalClearEnabled, globalClearShortcut, setGlobalClearEnabled, setGlobalClearShortcut, registrationError, globalClearReady }`.
- `registrationError` is non-null when `register` throws (combo already held by the OS/another app, or invalid); surfaced inline in the UI.
- `globalClearReady` is false until the initial load resolves; the capture control is disabled while not ready, matching the autostart pattern.
- Registration uses `@tauri-apps/plugin-global-shortcut`:
  - `register(accelerator, handler)` where `handler` fires `onClear.current()` only on key-press (guard on `event.state === "Pressed"` when present).
  - On enable→disable, combo change, or unmount: `unregister(previousAccelerator)` before registering the new one.
- Guards non-Tauri with `isTauri()`; in browser dev the hook is a no-op (no registration), but state still loads from defaults so the UI renders.

**`src/components/ShortcutCapture.jsx`** — the editable key-capture control:
- Click → enters "recording" mode (placeholder text "Press a combo…").
- Captures the next keydown, runs `keyEventToAccelerator`; if `null`, stays in recording mode with a hint ("Needs a modifier"). If valid, commits the accelerator and exits recording.
- Shows the current binding via `formatAcceleratorForDisplay`.
- Includes a small "reset to default" affordance.

**`src/data/keyboardShortcuts.js`** — static list of the read-only shortcuts:
```
[
  { id: "startStop", label: "Start / Stop", keys: "Space" },
  { id: "clear",     label: "Clear",        keys: "CmdOrCtrl+K" },
  { id: "settings",  label: "Settings",     keys: "CmdOrCtrl+," },
  { id: "fullscreen",label: "Fullscreen panel", keys: "1–6" },
  { id: "exitFull",  label: "Exit fullscreen",  keys: "Escape" },
]
```
Rendered through `formatAcceleratorForDisplay` for platform-correct glyphs.

### Modified files

**`src/hooks/useSettings.js`**
- Calls `useGlobalClearShortcut(...)` and merges its return values into the hook's return object (same pattern as `useAutostart`).

**`src/components/SettingsPanel.jsx`**
- Accepts the new props from `useSettings`.
- Renders the "Keyboard shortcuts" section: read-only rows from `keyboardShortcuts.js`, then the editable Global clear row (`Switch` + `ShortcutCapture` + optional `registrationError` text).

**`src/App.jsx`**
- Provides a stable `onClear` ref whose `.current` is `clearAll`, wired into `useSettings`/`useGlobalClearShortcut` so the global handler always calls the latest `clearAll` (mirrors the existing `shortcutHandlerRef` idiom).
- Destructures and forwards the new values to `SettingsPanel`.

**`src-tauri/Cargo.toml`**
```toml
tauri-plugin-global-shortcut = "2"
```

**`src-tauri/src/lib.rs`**
```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

**`src-tauri/capabilities/default.json`**
```json
"global-shortcut:allow-register",
"global-shortcut:allow-unregister"
```

**`package.json`**
```
"@tauri-apps/plugin-global-shortcut": "^2"
```

No custom Rust commands are needed — registration is driven entirely from JS via the plugin's IPC, the same way `useAutostart` uses the autostart plugin directly.

## Data flow

### Registration lifecycle
```
mount → loadGlobalClearPrefs() → { enabled, shortcut }
  if enabled && isTauri → register(shortcut, handler)

handler (system-wide keypress) → onClear.current()  // === clearAll()

toggle ON   → register(shortcut, handler)   → registrationError = null | error
toggle OFF  → unregister(shortcut)
change combo→ unregister(old) → register(new)
unmount     → unregister(current)
```

### Why `onClear` is a ref
`clearAll` is recreated each render and closes over current state. The global handler is registered once (or on combo change), so it must read the latest `clearAll` through a ref — the same reason `App.jsx` already routes its in-app shortcuts through `shortcutHandlerRef`.

## Edge cases

| Scenario | Behavior |
|---|---|
| First run (default) | Nothing registered; Global clear toggle is off |
| Combo already held by OS/another app | `register` throws → `registrationError` set → inline message "Combo unavailable, try another"; toggle stays as the user set it and retries on next change/launch |
| User enters a combo with no modifier | `ShortcutCapture` rejects it (stays recording, shows hint); never reaches `register` |
| Toggle off while registered | `unregister(current)`; no global capture |
| Change combo while enabled | Old unregistered before new registered |
| App restart with enabled=true | Re-registers stored combo on mount |
| Non-Tauri (browser dev) | Hook is a no-op; capture control disabled; read-only shortcut list still renders |
| Global combo overlaps in-app `Ctrl/Cmd+K` | Independent; the default global combo adds `Alt` to stay distinct. The user owns collision risk when customizing |
| Window hidden when shortcut fires | `clearAll` runs headless; no notification (by design) |

## Testing

- **`src/lib/accelerator.test.js`** — `keyEventToAccelerator` (valid combos, rejects bare keys / bare modifiers), `isValidAccelerator`, `formatAcceleratorForDisplay` (mac vs windows glyphs).
- **`src/lib/globalClearPrefs.test.js`** — defaults when unset, round-trip save/load, non-Tauri fallback (mirrors any existing `capturePrefs` test).
- **`SettingsPanel.test.jsx`** — renders the read-only shortcut rows and the editable Global clear row; toggle and capture controls are wired to the passed setters; disabled state when `!globalClearReady`.
- Registration side effects (`register`/`unregister`) are integration-level and kept thin in the hook; covered by mocking the plugin module in the hook's RTL test if one is added, otherwise exercised manually.
