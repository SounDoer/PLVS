# Tray Menu Redesign

**Date:** 2026-07-25
**Status:** Approved

## Overview

Rework the system tray menu built by `src/hooks/useTray.js`. The current menu carries two
items that no longer earn their place and wastes the device row as a static label. This
redesign removes the dead weight, turns the device row into a real input-device switcher,
and adds a presets entry — so the tray can drive the app's two most common state changes
(which device is captured, which layout preset is active) without first restoring the
window.

Left/right click behaviour and the close-confirm flow are unchanged. Only the menu content
and the `useTray` interface change.

## Current State (baseline)

Menu built in `useTray.js`:

```
Show Window / Hide Window     ← toggles window visibility
Pin Window / Unpin Window     ← toggles pinned state
──────────────
Start / Stop                  ← toggles capture
<device name>                 ← disabled, informational only
──────────────
Quit
```

- Left click (Windows) toggles the window via the tray `action` handler, not a menu item.
- macOS does not distinguish left/right click: any click opens the menu.
- `updateBusy` (true while `installStatus` is `installing` or `restarting`) disables
  `Show/Hide` and `Quit`; `Start/Stop` and `Pin` are ungated.

## Menu Structure (platform-conditional)

**Windows** (left click already toggles the window):

```
Start / Stop
──────────────
Input: <current device>   ▶
Presets                   ▶
──────────────
Quit
```

**macOS** (a click always opens the menu, so window toggle must live in it):

```
Show Window / Hide Window
──────────────
Start / Stop
──────────────
Input: <current device>   ▶
Presets                   ▶
──────────────
Quit
```

Removed: `Pin/Unpin Window` (both platforms); `Show/Hide Window` (Windows only — the
left-click `action` covers it). The old disabled `<device name>` row is absorbed into the
Input submenu's parent label.

Platform detection: `platform() === "macos"` from `@tauri-apps/plugin-os`.

## Input Device Submenu

- **Parent label:** `Input: <label>`.
  - When `captureDeviceId === "default"`, `<label>` is `defaultOutputLabel` (the resolved
    system-output name from `useAudioDevices`); if that is empty, fall back to `Default`.
  - Otherwise `<label>` is the matching entry's `label` from `audioDevices`.
- **Children:** a `Default (system output)` entry followed by each `audioDevices` item,
  each a `CheckMenuItem`. The `✓` sits on the entry matching the current `captureDeviceId`
  (`"default"` checks the Default entry).
- **On click:** `onSelectDevice(id)` (= `setCaptureDeviceIdAndPersist`). The capture engine
  restarts on its own via the existing `captureDeviceId` effect — the tray does not restart
  it.
- **Not gated by `updateBusy`** (see Update Gating).

## Presets Submenu

- **Children:** each `presets.list` item as a `CheckMenuItem`; the `✓` sits on `activeId`.
  - **On click:** `presets.apply(id)`.
  - **Dirty marker:** when an item's id equals `activeId` and `presets.dirty` is true, the
    text is `<name> (modified)`.
- **Empty list:** a single disabled `No presets` item, not an empty submenu.
- **Gated by `updateBusy`:** the parent item is `enabled: !updateBusy` (see Update Gating).

## Update Gating

One rule governs every item: **gate what interferes with the update, the window, or the
process; leave engine-only actions alone.**

| Item | Gated by `updateBusy`? | Reason |
| --- | --- | --- |
| Show/Hide Window (macOS) | Yes | Install progress shows in the window; hiding it mid-install is hostile. Existing behaviour. |
| Quit | Yes | Quitting mid-install can leave a half-applied update; a relaunch is imminent anyway. Existing behaviour. |
| Presets | Yes | `apply()` moves window bounds / dock / theme — same category as Show/Hide. |
| Start/Stop | No | Engine-only; orthogonal to the installer. Existing behaviour, unchanged. |
| Input device | No | Engine-only (restarts capture); same category as Start/Stop. |

Gated items use `enabled: !updateBusy` on the menu item **and** re-check `updateBusyRef` in
their click callback, matching the existing double-guard on Show/Hide and Quit.

Capture keeps running throughout an update — install is a background download; the engine
only stops when `relaunch()` restarts the process. Gating a button never stops capture; it
only blocks the manual toggle. That is why Start/Stop and Input device stay ungated.

## useTray Interface Change

Before:

```js
useTray({ running, pinned, togglePin, onStartClick, deviceName,
          onToggleWindow, colorScheme, updateBusy })
```

After:

```js
useTray({
  running, onStartClick,           // Start/Stop — unchanged
  onToggleWindow,                  // macOS menu item only; Windows still uses the left-click action
  colorScheme, updateBusy,         // unchanged
  audioDevices,                    // [{ id, label }]
  captureDeviceId,
  defaultOutputLabel,
  onSelectDevice,                  // = setCaptureDeviceIdAndPersist
  presets,                         // { list, activeId, dirty, apply }
})
```

- **Removed:** `pinned`, `togglePin` (Pin item gone); `deviceName` (replaced by the Input
  parent label).
- **Added:** the four device fields and the `presets` bundle. All already exist in
  `App.jsx` (returns of `useAudioDevices` and `usePresets`) — this only threads more props
  through, no new state.
- `buildMenu` extracts `buildDeviceSubmenu` and `buildPresetsSubmenu` helpers so the main
  builder does not grow unwieldy.
- **Left-click `action` unchanged:** Windows still calls `onToggleWindow` directly on left
  click, outside the menu.

## Behavioural Notes

- **Menu rebuild triggers grow.** The menu is a snapshot rebuilt in full on each relevant
  change. Today only `deviceName` triggers a rebuild; after this change `audioDevices`,
  `captureDeviceId`, `defaultOutputLabel`, `presets.list`, `presets.activeId`, and
  `presets.dirty` all do. These changes are infrequent (device hotplug, preset switch) and
  a full `setMenu` on a small menu is cheap, so the existing full-rebuild approach is kept.
  The `useTray` menu-rebuild effect's dependency array grows to include the new inputs.
- **Applying a preset while the window is hidden** may move/show the window (presets carry
  window bounds and dock state). This is acceptable and matches applying a preset from the
  in-app UI.

## Out of Scope

- Settings entry in the tray (deferred by user).
- Any change to Start/Stop gating or the left/right-click model.
- Any change to the close-confirm flow.

## Testing

`src/hooks/useTray.test.js` covers the menu build. Extend it for:

- Windows omits Show/Hide; macOS includes it.
- Pin/Unpin absent on both.
- Input parent label reflects `captureDeviceId` / `defaultOutputLabel`; `✓` on the active
  device; click calls `onSelectDevice`.
- Presets list with `✓` on `activeId`; `(modified)` when dirty; disabled `No presets` when
  empty; click calls `presets.apply`.
- `updateBusy` disables Presets (and Show/Hide, Quit) but not Start/Stop or Input device.

`useTray` is frontend code covered by CI — `npm run check` gates it. No capture-layer code
is touched.
