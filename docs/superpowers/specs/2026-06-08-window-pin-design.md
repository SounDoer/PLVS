# Window Pin (Always on Top) — Design Spec

**Date:** 2026-06-08
**Status:** Approved

## Goal

Add a toggle button to the toolbar that pins the PLVS window above all other OS windows (always-on-top). The state persists across sessions. Intended use case: keep PLVS visible alongside a DAW without manual window management.

## Scope

- OS-level always-on-top for the entire app window
- Toolbar button, globally visible (not per-panel)
- Persisted across launches via `localStorage`
- Tauri desktop only (not rendered in browser dev mode)
- Cross-platform: works on Windows and macOS

## Out of Scope

- System tray integration
- Custom title bar changes
- Per-panel pinning

---

## Architecture

### 1. Capability permission

**File:** `src-tauri/capabilities/default.json`

Add one entry to the `permissions` array:

```json
"core:window:allow-set-always-on-top"
```

This is the only Tauri configuration change required.

### 2. Hook: `useAlwaysOnTop`

**File:** `src/hooks/useAlwaysOnTop.js` (new)

Responsibilities:
- On mount: read `localStorage.getItem('plvs:windowPinned')`. If `'true'`, call `setAlwaysOnTop(true)` immediately to restore pinned state.
- `togglePin()`: compute next boolean, call `getCurrent().setAlwaysOnTop(next)` from `@tauri-apps/api/window`, write result to `localStorage`.
- Returns `{ pinned, togglePin }`.

The Tauri window API call is guarded so it only runs inside a Tauri environment (checked via the existing `isTauri()` helper before calling).

### 3. Toolbar button

**File:** `src/App.jsx`

Placement: between the audio device selector and the Layout & Modules popover.

```
[Transport] | [Clear] [AudioDevice] [Pin] [Layout] [Settings]
```

Rendered only when `isTauri()` is true (same pattern as the audio device selector).

- Icon: `Pin` (unpinned) / `PinOff` (pinned) from `lucide-react`
- Tooltip: `"Pin window on top"` / `"Unpin window"`
- Active/highlight state: `text-foreground` when pinned, `text-muted-foreground` otherwise (via `IconButton`'s existing `active` prop if available, or inline `cn()` class)

### 4. Persistence

| Key | `'plvs:windowPinned'` |
|---|---|
| Store | `localStorage` |
| Values | `'true'` / `'false'` (string) |
| Default | unpinned (`false`) |

Stored independently from the existing layout/theme JSON blob (`UI_PREFERENCES.layoutPersistKey`).

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/capabilities/default.json` | Add `core:window:allow-set-always-on-top` permission |
| `src/hooks/useAlwaysOnTop.js` | New hook (~30 lines) |
| `src/App.jsx` | Import hook, add `Pin`/`PinOff` icons, insert button in toolbar |

---

## Dependencies

- `@tauri-apps/api/window` — already in the project
- `lucide-react` (`Pin`, `PinOff`) — already in the project
