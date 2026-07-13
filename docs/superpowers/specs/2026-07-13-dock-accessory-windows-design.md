# Dock Accessory Windows and Independent Module Settings

**Date:** 2026-07-13  
**Status:** Implemented; automated gate and Windows 125% DPI geometry/header/Modules/Presets matrix passed on 2026-07-13. Settings drill-in is component-tested; macOS manual verification remains.

## Summary

Replace Dock mode's in-strip hover overlay and horizontal editors with two
purpose-built accessory windows:

- a full-width, 44 logical px `dock-header` window immediately outside the
  72px meter strip; and
- a compact `dock-editor` window for Modules, Presets, and per-module display
  settings.

The 72px meter window remains the only Win32 AppBar. When "Reserve screen
space" is enabled, Windows reserves only those 72px. Header and editor windows
temporarily overlay the neighboring application area, so maximized windows do
not resize or jump as Dock controls appear.

Dock module display settings become an explicit Dock-owned persistence domain.
They reuse the same product language and UI primitives as normal panel
settings, but do not synchronize with any workspace panel instance. Global
measurement semantics and runtime state remain shared.

This spec supersedes the in-strip `DockControls`, horizontal Modules editor,
and horizontal Presets row decisions in
`2026-07-11-dock-mode-design.md`. All other Dock mode decisions remain in
force.

## Locked product decisions

| Topic               | Decision                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Meter strip         | Remains a dedicated 72 logical px window and the only AppBar.                                                             |
| Header              | Separate frameless window, full strip width, 44 logical px high.                                                          |
| Header layout       | Left: existing `SourceTransportCluster`/timecode pill. Right: Clear, Modules, Presets, edge, Reserve, Restore.            |
| Header placement    | Bottom Dock: above meter strip. Top Dock: below meter strip.                                                              |
| Editor              | Separate frameless window, 380-420 logical px wide, single-column drill-in navigation.                                    |
| Editor placement    | Right-aligned to header. Bottom Dock opens upward; Top Dock opens downward.                                               |
| Reserve semantics   | Reserve only 72px meter strip. Header/editor overlay adjacent apps. Never resize the AppBar on hover.                     |
| Visibility          | Enter meter strip shows header. Leaving strip and header hides after 300ms. Open editor locks both visible.               |
| Dismissal           | Toggling the active header button, outside click, or Escape closes editor. Header then returns to hover visibility rules. |
| Modules UI          | Normal panel-instance list with icons, settings, rename, delete confirmation, drag handles, and Add Module.               |
| Presets UI          | Moves to the accessory editor and uses the normal-size presets interaction model.                                         |
| Settings navigation | Modules list -> module settings -> Back. No nested popover is required.                                                   |
| Settings ownership  | Dock display controls are independent from workspace panel-instance controls.                                             |
| Shared state        | Capture, source, channel labels/layout, theme, opacity, measurement semantics, and runtime actions stay shared.           |
| Multi-monitor       | All three windows stay on the meter strip's current monitor and move together on edge changes.                            |

## Why two accessory windows

A WebView cannot paint beyond its native window bounds. The current horizontal
edit rows exist because all content is clipped to the 72px strip. Enlarging
the AppBar window would couple hover state to Windows work-area negotiation and
make maximized applications jump.

One full-width, editor-height transparent accessory window is also rejected:
its transparent area would still intercept pointer input over applications
behind it. Two native windows keep hit-testing honest:

```text
Bottom Dock

                       +---------------- dock-editor ----------------+
                       | Modules / Presets / module settings         |
                       +---------------------------------------------+
+------------------------------ dock-header -------------------------+
| SourceTransportCluster                           Dock actions       |
+--------------------------------------------------------------------+
+------------------------------- main -------------------------------+
|                         72px meter strip                           |
+--------------------------------------------------------------------+

Top Dock mirrors the vertical order.
```

## Window architecture

### Native ownership

Rust owns all three window forms and their physical-pixel geometry:

- `main`: existing workspace/meter window; becomes the 72px Dock strip.
- `dock-header`: transparent, undecorated, non-resizable, always-on-top,
  skipped from taskbar, full strip width, 44 logical px.
- `dock-editor`: transparent, undecorated, non-resizable, always-on-top,
  skipped from taskbar, 400 logical px target width, content-dependent bounded
  height.

Accessory windows are created lazily on first Dock entry or during boot restore
and start hidden. They are hidden on Dock exit and destroyed during app
shutdown. They are never registered with `SHAppBarMessage`.

Geometry is computed from the same resolved monitor, edge, and scale factor as
the meter strip. Pure functions return physical rectangles for header and
editor, with clamping when a monitor cannot fit the preferred editor height.

### AppBar interaction

`dock-header` and `dock-editor` do not change the registered AppBar rectangle.
The meter strip remains 72 logical px whether accessories are hidden or shown.
Switching Top/Bottom performs this sequence:

1. renegotiate/move the meter AppBar;
2. compute accessory rectangles from the accepted strip edge;
3. move header and any open editor;
4. republish the current edge to accessory UI.

This keeps other applications' work area stable during hover and editing.

## Frontend surfaces and state bridge

Each Tauri WebView has a separate JavaScript realm. React context, hooks, and
in-memory stores cannot be shared directly. `main` remains the only owner of
Dock state and runtime actions.

`main.jsx` selects a root by an initialization value or URL query:

- `main` -> existing `App`;
- `dock-header` -> `DockHeaderApp`;
- `dock-editor` -> `DockEditorApp`.

Accessory roots are presentation clients. A typed event bridge carries:

- `dock-accessory://state`: main -> accessory versioned snapshot;
- `dock-accessory://action`: accessory -> main user intent;
- `dock-accessory://pointer`: header/editor enter/leave coordination;
- `dock-accessory://ready`: accessory asks main to replay the latest snapshot.

Snapshots are serializable and contain no audio-frame arrays. Header state
contains transport display state, clear availability, notice, edge, and
reserve state. Editor state contains view, modules, Dock controls, preset list,
active/dirty state, and option catalogs required by the active settings page.

Actions use semantic names (`clear`, `toggle-module`, `reorder-module`,
`open-module-settings`, `update-module-controls`, `apply-preset`, etc.).
Accessory code never invokes the Rust audio engine directly. Native Dock window
commands continue through `src/ipc/`.

Every snapshot carries a monotonically increasing `revision`; accessory roots
ignore older revisions. Actions that can race include the revision they were
rendered from, and main validates them against current state where needed.

## Hover and focus behavior

The main Dock strip and header report pointer presence to one coordinator in
the main WebView:

- entering either surface cancels the hide timer;
- leaving both surfaces starts the existing 300ms timer;
- an open editor sets `lockedOpen = true` and suppresses auto-hide;
- toggling the active header button, outside click, or Escape clears the lock and closes editor;
- Dock exit immediately cancels timers and hides both accessories.

There is no geometric gap between strip and header. The timer still protects
against cross-window pointer event ordering.

Outside-click dismissal uses focus loss only while an editor is open. Header
activation by itself must not hide the header or stop audio keyboard behavior
in the main window.

## Header design

The header preserves the existing Dock control ordering and semantics:

1. `SourceTransportCluster`, source locked to LIVE;
2. flexible notice/status region;
3. Clear;
4. Modules;
5. Presets;
6. Windows-only Reserve screen space;
7. Top/Bottom edge switch;
8. Restore window.

It uses the existing theme tokens, icon family, tooltips, and 28px controls.
The full-width header is visually opaque/translucent only within its 44px
window; there is no invisible oversized hit region.

The always-visible health dot remains on the 72px meter strip. The notice text
continues to appear in the header.

## Editor information architecture

The editor is a single-column tool surface, not a popover inside the header.

### Modules root

Each Dock panel instance appears as one vertical row:

- drag handle;
- normal-mode module icon;
- label;
- settings icon when the panel's Dock renderer has display settings.
- inline rename action;
- delete confirmation action.

Panels can be reordered. Add Module uses the normal workspace module catalog
plus Dock-only Timecode, and can add multiple instances of the same module
family. Legacy `transport` rows are displayed as Timecode.

### Module settings drill-in

Selecting a settings icon replaces the list with:

- Back;
- panel display name;
- Reset;
- Dock-specific settings content.

The UI reuses settings rows, switches, selects, sliders, range inputs, sortable
lists, labels, and wording extracted from `PanelSettingsContent`. It does not
mount `PanelSettingsMenu` or a nested Radix popover.

### Presets root

Presets use the normal-size interaction model: apply saved presets, show
active/dirty state, save a named preset, and expose the same update/rename/
delete confirmation behavior already used by `PresetsPopoverContent` where it
fits. Preset UI primitives should be extracted/shared rather than duplicated.

## Dock controls ownership

The current Dock implementation partially derives controls from a normalized
workspace panel and uses default spectrum controls. That coupling is removed.

Persist the primary Dock layout under the existing `workspaceStore` `dock`
object as panel instances:

```js
{
  panelOrder: ["level", "spectrum", "spectrum-2"],
  panelsById: {
    level: { id: "level", moduleId: "levelMeter" },
    spectrum: { id: "spectrum", moduleId: "spectrum" },
    "spectrum-2": { id: "spectrum-2", moduleId: "spectrum", customTitle: "Sidechain RTA" }
  },
  controlsByPanelId: {
    level: { /* DockLevel display controls */ },
    spectrum: { /* DockSpectrum display controls */ },
    "spectrum-2": { /* DockSpectrum display controls */ }
  }
}
```

Use a Dock-specific normalized schema. Do not persist a full
`PanelControls` object per module because most fields would be irrelevant and
some fields represent global measurement semantics.

During this local development phase, persisted Dock state and preset snapshots
use only `panelOrder` / `panelsById` / `controlsByPanelId`. Legacy `modules`,
`controlsByModuleId`, and `statsIds` fields are not written back, so there is a
single source of truth for ordering and per-panel display controls.

Initial control families:

| Module      | Dock-owned display controls                                          |
| ----------- | -------------------------------------------------------------------- |
| Level       | displayed detector/readout options supported by `DockLevel`          |
| Loudness    | primary M/S/I metric, reference-line visibility/value                |
| Spectrum    | channel, view, smoothing, tilt, peak hold/display range as supported |
| Correlation | channel pair and Dock display/hold options                           |
| Stats       | selected 0-4 readouts and order                                      |
| Waveform    | channel/view and Dock display scale options                          |
| Spectrogram | channel/view, dB range, colormap/display options                     |
| Timecode    | none                                                                 |

Settings that are not yet meaningful in the compact renderer should not be
shown merely because a normal panel has them.

### Shared versus independent rule

Shared:

- source/capture and transport runtime;
- audio frames/history and analysis engine;
- channel layout and user channel labels;
- theme, opacity, and health/notice state;
- global measurement semantics such as dialogue gating/VAD;
- Clear and Start/Stop actions.

Independent:

- every Dock panel display choice;
- panel instances, custom titles, and order;
- Dock Stats readout selection;
- Dock editor navigation state (ephemeral).

Changing a Dock Spectrum panel does not mutate any normal Spectrum panel or any
other Dock Spectrum instance. Changing a normal panel does not mutate Dock
Spectrum.

## Analysis requests

Dock-owned controls must drive Dock's keyed spectrum/spectrogram requests.
`dockAnalysisRequest.js` stops using `DEFAULT_CONTROLS` as the fixed request.
Request keys and payloads derive from normalized Dock panel controls. Workspace
requests remain untouched; while docked, Dock requests still receive priority
within `MAX_SPECTRUM_REQUESTS` because workspace panels are not visible.

Changing a Dock analysis control updates the backend request and the panel's
snapshot lookup key together, so the renderer cannot read stale/default data.

## Persistence and presets

- `workspaceStore.dock` owns panel instances and `controlsByPanelId`.
- Preset `dock` snapshots contain `panelsById`, `panelOrder`, and
  `controlsByPanelId`.
- Presets without Dock controls normalize to defaults.
- Applying an old Dock preset preserves backward compatibility.
- Applying a Dock preset updates panel instances and controls before entering
  Dock, so the first visible frame uses the intended configuration.
- Accessory visibility/navigation is never persisted or captured.

## Security and capabilities

Accessory labels must be explicitly listed in Tauri capabilities. Prefer a
minimal accessory capability that permits only required event and window
operations. Accessory roots must not gain direct audio-engine invoke access;
all semantic actions route to main.

## Failure behavior

- If header creation/show fails, the 72px meter strip remains usable and the
  health notice reports the failure; Restore remains available through a
  fallback keyboard command or tray action.
- If editor creation fails, header remains visible and reports the failure.
- If an accessory crashes/reloads, it emits `ready` and receives the latest
  snapshot without changing Dock state.
- Monitor removal recomputes meter/header/editor geometry against the primary
  monitor.
- Dock exit and app shutdown hide/destroy accessories and remove AppBar state.
- Stale accessory actions are ignored or normalized against current state.

## Testing

### Vitest

- Dock control schema normalization, migration, reset, and persistence.
- Preset capture/apply including old presets without controls.
- Event snapshot/action reducer and stale-revision handling.
- Header control ordering and Windows-only Reserve action.
- Hover coordinator across strip/header/editor presence.
- Vertical Modules list, reorder, add/remove, settings drill-in, Back/Reset.
- Presets editor behavior using shared primitives.
- Dock analysis request keys derive from Dock controls.
- Dock modules render from Dock controls, independent of workspace controls.

### Rust

- Header/editor physical rects for Top/Bottom and DPI scaling.
- Secondary-monitor offsets and editor clamping.
- Accessory creation options and idempotent show/hide lifecycle where testable.
- Edge changes reposition all Dock windows without changing AppBar height.

### Manual Windows/macOS

- Header crosses from meter strip without flicker.
- Header hides after 300ms only when no Dock surface is hovered.
- Editor stays open while interacted with and dismisses by active-button toggle,
  Escape, or outside click.
- Transparent areas do not block applications behind them.
- Bottom and Top placement at 100%, 150%, and mixed-DPI monitors.
- Windows Reserve keeps maximized window geometry stable while header/editor
  appear, and releases work area on Dock exit.
- Restart while docked restores meter/AppBar state but does not reopen editor.

## Explicitly out of scope

- Reserving header/editor space with AppBar.
- Synchronizing Dock display controls with workspace panel instances.
- Arbitrary editor docking, dragging, resizing, or user-selected width.
- Left/right vertical Dock forms.
- Dock FILE mode.
- Rendering audio visualizations inside accessory windows.
