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

Platform detection: `isMacOS()` from `@/lib/platform.js` (already used across the app; no
new dependency — it reads `navigator.platform` / `userAgent`).

## Input Device Submenu

Mirrors the in-app device picker (`AppHeader`): the same three-way grouping, the same
labels, so the two never disagree. The device the app captures may be a system-output
monitor, so the parent is labelled `Device:` (not `Input:`), and the groups reuse the app's
`Automatic` / `Output` / `Input` wording.

- **Parent label:** `Device: <label>`.
  - When the selection is `"default"`, `<label>` is `formatAudioDeviceLabel(defaultOutputLabel)`
    (the resolved system-output name); if `defaultOutputLabel` is empty, fall back to
    `Automatic`.
  - Otherwise `<label>` is `formatAudioDeviceLabel` of the matching device's `label`.
- **Selection source:** use `safeAudioDeviceId` (already falls back to `"default"` when the
  stored id is gone), not the raw `captureDeviceId`, for the `✓`.
- **Children** (a `CheckMenuItem` per device, `✓` on the selected one):
  - `Automatic (default system output)` — checked when `safeAudioDeviceId === "default"`.
  - If `audioOutputs.length`: a `Separator`, a disabled `Output` header item, then each
    `audioOutputs` device.
  - If `audioInputs.length`: a `Separator`, a disabled `Input` header item, then each
    `audioInputs` device.
  - `audioOutputs` = devices with `isSystemOutputMonitor === true`; `audioInputs` = the
    rest. Both are already computed in `App.jsx` and passed in.
  - Device labels use `formatAudioDeviceLabel(device.label)` from `@/lib/audioDeviceLabels.js`.
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
  audioOutputs,                    // [{ id, label, isSystemOutputMonitor }] — monitors
  audioInputs,                     // [{ id, label }] — real inputs
  safeAudioDeviceId,               // current selection, "default" when the stored id is gone
  defaultOutputLabel,              // resolved system-output name for the Automatic label
  onSelectDevice,                  // = setCaptureDeviceIdAndPersist
  presets,                         // { list, activeId, dirty, apply }
})
```

- **Removed:** `pinned`, `togglePin` (Pin item gone); `deviceName` (replaced by the Device
  parent label).
- **Added:** the five device fields and the `presets` bundle. All already exist in
  `App.jsx` (`audioOutputs`, `audioInputs`, `safeAudioDeviceId` memos, plus the returns of
  `useAudioDevices` and `usePresets`) — this only threads more props through, no new state.
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
- **`CheckMenuItem`** comes from `@tauri-apps/api/menu` (alongside `MenuItem` /
  `PredefinedMenuItem`). Disabled group headers (`Output`, `Input`) are plain `MenuItem`
  with `enabled: false`, matching the existing disabled-item pattern.

## Out of Scope

- Settings entry in the tray (deferred by user).
- Any change to Start/Stop gating or the left/right-click model.
- Any change to the close-confirm flow.

## Testing

`src/hooks/useTray.test.js` covers the menu build. Extend it for:

- Windows omits Show/Hide; macOS includes it.
- Pin/Unpin absent on both.
- Device parent label reflects `safeAudioDeviceId` / `defaultOutputLabel`; `✓` on the
  selected device; `Output` / `Input` group headers present when those groups are non-empty;
  click calls `onSelectDevice`.
- Presets list with `✓` on `activeId`; `(modified)` when dirty; disabled `No presets` when
  empty; click calls `presets.apply`.
- `updateBusy` disables Presets (and Show/Hide, Quit) but not Start/Stop or Input device.

`useTray` is frontend code covered by CI — `npm run check` gates it. No capture-layer code
is touched.
