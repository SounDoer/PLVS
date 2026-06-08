# System Tray Design

**Date:** 2026-06-08
**Status:** Approved

## Overview

Add system tray support to PLVS so the app can live in the background after the user closes the main window, with a tray icon that provides quick access to core actions.

## Architecture

The feature has three independent parts:

1. **Tray icon + menu** — created and managed from the frontend JS using `@tauri-apps/plugin-tray`. The frontend already owns all relevant state (running, pinned, device name), so no state sync with Rust is needed.
2. **Close dialog** — a custom in-app dialog (matching PLVS dark theme) shown when the user clicks ×. Preference is persisted to localStorage so the user is not asked again after choosing.
3. **Rust-side additions** — only two: register the tray plugin in `lib.rs`, add the dependency in `Cargo.toml`.

## Tray Icon and Menu

**Icon:** reuse `src-tauri/icons/32x32.png` (already present).

**Menu structure:**

```
Show Window  /  Hide Window      ← toggles on window visibility
Pin Window   /  Unpin Window     ← toggles on pinned state
─────────────────────────────
Start        /  Stop             ← toggles on running state
<device name>                    ← disabled, informational only
─────────────────────────────
Quit
```

**Click behavior (Windows):**
- Left click → show/hide window
- Right click → open full menu

**Click behavior (macOS):**
- macOS tray (Menu Bar Extra) does not distinguish left/right click — clicking the icon opens the menu directly.

**Dynamic menu updates:**
When `running`, `pinned`, or `deviceName` changes, rebuild the `Menu` object and call `trayRef.current.setMenu(newMenu)`. The tray icon itself is not recreated.

**Show/hide window implementation:**
- Show: `getCurrent().show()` + `getCurrent().setSkipTaskbar(false)`
- Hide: `getCurrent().hide()` + `getCurrent().setSkipTaskbar(true)`

`setSkipTaskbar` is Windows-only and a no-op on macOS, so it is safe to call unconditionally.

**macOS Dock behavior:**
When the window is hidden, the Dock icon remains visible (macOS plan A). Users can click the Dock icon or use the tray menu to re-show the window. Dynamic `ActivationPolicy` switching is out of scope for this version.

## Close Dialog

**Trigger flow:**
```
User clicks ×
  → getCurrent().onCloseRequested() intercepts, prevents default close
  → reads localStorage key plvs:closeAction
      → "tray"  → hide window + setSkipTaskbar(true), no dialog
      → "quit"  → exit(0), no dialog
      → absent  → show CloseConfirmDialog
```

**Dialog UI:**

```
┌──────────────────────────────────────┐
│  Close PLVS                          │
│                                      │
│  ○  Minimize to tray                 │
│  ○  Quit                             │
│                                      │
│  □  Don't ask again                  │
│                                      │
│              [ Cancel ]  [ Confirm ] │
└──────────────────────────────────────┘
```

- Default selection: "Minimize to tray"
- Cancel: closes the dialog, window stays open, nothing is persisted
- Confirm: executes the selected action; if "Don't ask again" is checked, writes the action to `plvs:closeAction` in localStorage
- Style: uses existing shadcn/Radix Dialog, PLVS dark theme

**Quit implementation:** `exit(0)` from `@tauri-apps/plugin-process`.

## localStorage Keys

| Key | Values | Meaning |
|-----|--------|---------|
| `plvs:closeAction` | `"tray"` / `"quit"` / absent | Persisted close preference. Absent means show dialog. |

## New Files

| File | Responsibility |
|------|---------------|
| `src/hooks/useTray.js` | Creates tray on mount, updates menu when state changes, handles left-click show/hide |
| `src/hooks/useCloseConfirm.js` | Intercepts close-requested, reads/writes `plvs:closeAction`, exposes dialog open state |
| `src/components/CloseConfirmDialog.jsx` | Dialog UI component |

## Modified Files

| File | Change |
|------|--------|
| `src/App.jsx` | Call `useTray(...)`, render `<CloseConfirmDialog>` |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-tray = "2"` |
| `src-tauri/src/lib.rs` | Add `.plugin(tauri_plugin_tray::init())` |
| `package.json` | Add `@tauri-apps/plugin-tray`, `@tauri-apps/plugin-process` |
| `src-tauri/capabilities/` | Add tray and process-exit permissions |

## useTray Hook Interface

```js
useTray({ running, pinned, togglePin, onStartClick, deviceName })
```

All arguments come from existing state already present in `AppContent`. The hook is side-effect only (returns nothing). Internally it holds a `trayRef` for the `TrayIcon` instance.

## Out of Scope

- macOS dynamic Dock icon hiding (ActivationPolicy switching)
- Settings panel entry to reset `plvs:closeAction` (can be added later)
- Tray badge or animated icon to indicate capture state
