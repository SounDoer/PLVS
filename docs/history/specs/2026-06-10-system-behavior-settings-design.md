# System Behavior Settings

**Date:** 2026-06-10
**Status:** Approved

## Overview

Add an "Open at login" toggle and a "Close behavior" selector to the Settings panel, grouped as a new "system behavior" section at the top of the panel.

## Motivation

- "Open at login" is a common desktop app feature with no current implementation.
- "Close behavior" (minimize to tray vs quit) already works via a first-time dialog with "Don't ask again," but once saved, users have no UI to change the preference — they'd have to clear localStorage manually.

## UI Layout

The new section sits at the top of the Settings panel, separated from the existing appearance/audio settings by a `Separator`:

```
Open at login    [Switch]
Close behavior   [Select: Ask each time | Minimize to tray | Quit]
──────────────────────────────────────────────────────────────────
Appearance       [Select]
Colour theme     [Select, conditional]
Loudness reference  [Input]
Channel layout   [Select]
...version info
```

## Architecture

### New files

**`src/components/ui/switch.jsx`**
Standard shadcn Switch component. Used only for "Open at login."

**`src/hooks/useAutostart.js`**
Wraps `tauri-plugin-autostart` IPC commands.
- On mount: calls `invoke("plugin:autostart|is_enabled")` to read current OS state.
- Returns `{ autostartEnabled, setAutostartEnabled, autostartReady }`.
- `autostartReady` is false until the initial `is_enabled` call resolves; the Switch is disabled while `!autostartReady` to prevent state flicker.
- Guards against non-Tauri environments with `isTauri()` check; in browser dev the hook is a no-op and the Switch stays disabled.

### Modified files

**`src/hooks/useSettings.js`**
- Calls `useAutostart()` and merges its return values into the hook's return object.
- Adds `closeAction` / `setCloseAction` state, initialized from `localStorage.getItem("plvs:closeAction")` (null → `"ask"`).
- `setCloseAction` writes to `localStorage` and updates state.

**`src/components/SettingsPanel.jsx`**
- Accepts new props: `autostartEnabled`, `setAutostartEnabled`, `autostartReady`, `closeAction`, `setCloseAction`.
- Renders new system section at top with Switch + Select, then Separator, then existing settings.

**`src/App.jsx`**
- Destructures new values from `useSettings()` and passes them as props to `SettingsPanel`.

**`src-tauri/Cargo.toml`**
```toml
tauri-plugin-autostart = "2"
```

**`src-tauri/src/lib.rs`**
```rust
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    None,
))
```

**`src-tauri/capabilities/default.json`**
```json
"autostart:allow-enable",
"autostart:allow-disable",
"autostart:allow-is-enabled"
```

No custom Rust commands needed — the plugin exposes its own IPC directly.

## Data flow

### Open at login
```
mount → invoke("plugin:autostart|is_enabled") → autostartEnabled state
toggle ON  → invoke("plugin:autostart|enable")  → update state
toggle OFF → invoke("plugin:autostart|disable") → update state
```

### Close behavior
```
mount → localStorage.getItem("plvs:closeAction") → closeAction state (null → "ask")
change → localStorage.setItem(...) + setState
close button → useCloseConfirm reads same key → executes action directly (no dialog if saved)
```

The Settings Select and the existing `CloseConfirmDialog` read/write the same `plvs:closeAction` key. No changes to `useCloseConfirm` or `CloseConfirmDialog` are needed.

## Edge cases

| Scenario | Behavior |
|---|---|
| Non-Tauri (browser dev) | `useAutostart` is a no-op; Switch renders as disabled |
| `is_enabled` call fails | `autostartReady` stays false; Switch stays disabled; no crash |
| User changes close behavior in Settings | Next close executes directly without dialog |
| User changes close behavior via dialog | Setting reflects new value next time Settings opens (initialized from localStorage) |
