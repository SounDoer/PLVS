# Focus View - Borderless Controls and Compact Panels

**Date:** 2026-06-18
**Status:** Approved
**Related:** `2026-06-18-presets-redesign-design.md`, `2026-06-18-presets-toolbar-design.md`

## Summary

Add a new **Focus View** toolbar entry for recording, presentation, and small
monitoring workflows where PLVS should spend as little screen space as possible
on non-meter UI.

Focus View contains two independent, stackable options:

- **Auto-hide controls** - window-level cleanup. The app enters a borderless /
  frameless window shape, and the main header/footer become auto-hiding overlay
  controls.
- **Compact panels** - panel-level cleanup. Each workspace panel hides its tab
  strip, panel chips, fullscreen button, and close button so the chart body fills
  the released space.

The two options are not mutually exclusive. Users can enable either, both, or
neither.

Both option values are persisted in settings and are captured into user presets.
Applying a preset restores the Focus View values together with the saved layout,
panel controls, window bounds, and window pin state.

## Motivation

Users want to run PLVS beside screen recording software and keep the captured
window clean. The current app shell spends vertical space on the header/footer,
while the system window frame adds another visible edge. Inside the workspace,
each panel also spends space on tab labels, display chips, fullscreen, and close
controls.

These are two separate layers:

- The **app shell / window frame** should be removable without changing the
  semantic layout of panels.
- The **panel chrome** should be removable without forcing a borderless window.

Keeping the options independent supports four useful states:

| Auto-hide controls | Compact panels | Use case |
| --- | --- | --- |
| Off | Off | Normal editing and configuration |
| On | Off | Recording while keeping panel identities and controls visible on reveal |
| Off | On | Small always-on monitoring window inside the normal OS frame |
| On | On | Cleanest recording / presentation layout |

## Toolbar entry

Add a new toolbar popover trigger in the right-side header toolbar.

Suggested order:

```
[Start] [Clear] [AudioDevice] [Pin] [Modules] [Presets] [Focus View] [Settings]
```

Rationale: Modules and Presets are view-structure controls; Focus View is another
view-level display control; Settings remains the right-most global application
configuration entry.

Trigger:

- **Icon:** `Focus` from `lucide-react`.
- **Tooltip:** `"Focus View"`.
- **Active highlight:** render in `text-foreground` when either Focus View
  option is enabled.

Popover content:

- Header label: `"Focus View"`.
- Switch: `"Auto-hide controls"`.
- Switch: `"Compact panels"`.

Avoid the term "chrome" in user-facing text. In design/implementation notes,
"chrome" may describe non-content UI, but it is easy to confuse with Google
Chrome.

## Option: Auto-hide controls

### Behaviour

When enabled:

- The window becomes frameless / borderless.
- The main header and footer no longer reserve layout space.
- The workspace content fills the full window.
- Header/footer render as overlays above the workspace.
- Header/footer are hidden by default.
- Moving the pointer near the top edge reveals the header.
- Moving the pointer near the bottom edge reveals the footer/status strip.
- Open popovers/selects keep the controls visible until they close.
- `Esc` reveals the controls if they are hidden. It does not need to disable the
  mode in v1.

When disabled:

- The normal system window frame returns.
- Header/footer return to normal in-flow layout.
- The workspace content no longer sits underneath overlay controls.

### Window dragging

Default mode keeps the normal system title bar, so dragging is owned by the OS.

In Auto-hide controls mode:

- Do not turn the main chart area into a drag region.
- Provide a small top-edge drag/reveal hot zone, roughly 8-12 px high.
- When the header is revealed, make the header background / empty area draggable.
- Interactive controls inside the header remain clickable and must not start a
  window drag.

This preserves chart interactions such as history scrubbing, wheel zooming, split
resize rails, and future panel gestures.

### Frameless implementation

The implementation should prefer the Tauri window API if the installed version
exposes a runtime decorations setter. If not, add a small Rust command that
toggles decorations for the main window.

Startup behaviour must respect persisted settings: if the last saved state has
`focusView.autoHideControls === true`, the app should enter frameless mode early
enough that the first visible window does not flash the normal frame if that can
be done without destabilizing startup.

Manual verification on Windows is required for:

- Toggle on/off while the app is running.
- Moving the frameless window via the top hot zone / revealed header.
- Resizing the frameless window.
- Maximized and restored windows.
- Taskbar and always-on-top behaviour.

## Option: Compact panels

When enabled:

- `LeafView` hides the slot header (`data-leaf-tabs`).
- Tab pills, panel title/icon, display chips, fullscreen, and close/hide controls
  are not rendered.
- The panel body (`data-leaf-body`) expands into the space previously occupied by
  the slot header.
- The panel card/border remains, so split layouts still read as separate panels.
- Drag/drop tab rearrangement is unavailable while compact panels are enabled,
  because the tab targets are hidden.

When disabled:

- Panel headers and all existing controls return unchanged.

First version explicitly does **not** add hover labels or temporary panel labels.
The goal is a clean capture surface. If users later report that compact
multi-panel layouts are too ambiguous, a lightweight hover label can be designed
as a follow-up.

## Persistence and presets

Add `focusView` to the settings domain:

```js
{
  focusView: {
    autoHideControls: false,
    compactPanels: false,
  }
}
```

The settings hook exposes both values and setters. Values are written to
`settingsStore` like other app-level preferences.

Extend the preset snapshot shape with:

```js
{
  focusView?: {
    autoHideControls: boolean,
    compactPanels: boolean,
  }
}
```

`usePresets.save()` and `usePresets.update()` capture the current Focus View
settings. `usePresets.apply()` restores them after applying the workspace view
and window state. If an older preset has no `focusView`, applying it leaves the
current Focus View settings unchanged to avoid surprising mode exits from legacy
data.

Manual edits to Focus View settings should clear `presetsStore.activeId`, just as
manual layout/module/panel-control edits do. Otherwise the footer can claim a
preset is still active after the user changes an option that presets now own.

## Keyboard behaviour

V1 requires:

- `Esc` reveals hidden controls when Auto-hide controls is enabled.

Optional follow-up:

- Add a shortcut to open the Focus View popover or toggle Auto-hide controls.

Do not block existing shortcuts:

- `Space` still starts/stops monitoring.
- The configured clear shortcut still clears history.
- `Ctrl/Cmd + ,` still opens Settings.

## Out of scope

- Hover panel labels in Compact panels mode.
- Transparent window backgrounds.
- Click-through overlays.
- Lock-layout mode.
- Recording-specific branding or a "Recording View" name.
- Saving Focus View state into global theme/layout tokens.
- Reworking panel internals beyond releasing the hidden header space.

## Testing notes

- Settings normalization: missing or malformed `focusView` falls back to both
  options off.
- Settings persistence: toggling each switch writes only the Focus View fields
  without dropping existing settings.
- Presets: save/update capture Focus View; apply restores Focus View; applying an
  older preset without `focusView` leaves current Focus View unchanged.
- Active preset divergence: manually toggling either Focus View option clears the
  active preset.
- Toolbar: Focus View trigger renders, highlights when either option is on, and
  opens a popover with both switches.
- Shell layout: Auto-hide controls switches header/footer from in-flow to overlay
  rendering and expands the workspace.
- Keyboard: `Esc` reveals controls when hidden.
- Compact panels: panel header is absent and the active panel body still renders.
- Desktop manual QA: frameless toggle, drag hot zone, resize, maximize/restore,
  always-on-top interaction, and screen-recording capture surface.
