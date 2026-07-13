# Dock Accessory Windows and Module Settings Implementation Plan

> Implement task-by-task with targeted tests at every boundary. Keep `main` as
> the only owner of runtime and persistence state; accessory WebViews are
> presentation clients.

**Goal:** Move Dock controls and editing outside the 72px meter strip into a
44px full-width header window plus a compact editor window, while introducing
independent Dock module display settings and preserving stable AppBar
reservation.

**Design:**
`docs/superpowers/specs/2026-07-13-dock-accessory-windows-design.md`

**Architecture:** Rust owns physical geometry and lifecycle for `main`,
`dock-header`, and `dock-editor`. The main React root owns Dock/runtime state
and synchronizes serializable snapshots/actions with accessory roots through a
small Tauri event bridge. Dock display controls persist under
`workspaceStore.dock.controlsByModuleId`, independent from workspace
`panelControlsById`.

**Merge gate:** `npm run check`, followed by the manual multi-window/AppBar
matrix in Task 14.

---

### Task 1: Dock control schema and legacy migration

**Files:**

- Create: `src/dock/dockModuleControls.js`
- Create: `src/dock/dockModuleControls.test.js`
- Modify: `src/dock/dockLayout.js`
- Modify: `src/dock/dockLayout.test.js`
- Modify: `src/dock/useDockLayout.js`
- Modify: `src/dock/useDockLayout.test.js`

- [ ] Define `DEFAULT_DOCK_CONTROLS_BY_MODULE_ID` with only Dock-relevant
      display fields for level, loudness, spectrum, correlation, stats,
      waveform, and spectrogram.
- [ ] Add per-module normalizers that reject unknown values, clamp numeric
      ranges, normalize channel selections, cap Stats at four ids, and clone
      arrays/objects.
- [ ] Add `normalizeDockControlsByModuleId(raw, legacyStatsIds)` and a focused
      `updateDockModuleControls` helper.
- [ ] Migrate persisted `dock.statsIds` into `controlsByModuleId.stats` while
      continuing to read old values. New writes omit `statsIds`.
- [ ] Extend `useDockLayout` with `controlsByModuleId`,
      `setModuleControls(id, next)`, and `resetModuleControls(id)`.
- [ ] Preserve modules/order and dirty tracking. Prove Dock controls are cloned
      and never share references with workspace panel controls.
- [ ] Run:
      `npm run test -- src/dock/dockModuleControls.test.js src/dock/dockLayout.test.js src/dock/useDockLayout.test.js`

### Task 2: Accessory geometry pure functions

**Files:**

- Modify: `src-tauri/src/dock.rs`

- [ ] Add constants `DOCK_HEADER_LOGICAL_HEIGHT = 44.0`, preferred editor
      width `400.0`, bounded editor height, and logical edge/inset values.
- [ ] Add pure functions that compute physical `WindowBounds` for header and
      editor from the accepted strip rect, monitor rect, edge, scale, and
      requested editor height.
- [ ] Bottom: header immediately above strip; editor right-aligned and above
      header. Top mirrors this below the strip/header.
- [ ] Clamp editor width/height and coordinates to the monitor without changing
      the meter/AppBar rect.
- [ ] Cover 100%/150% DPI, negative secondary-monitor offsets, tiny monitors,
      and both edges with Rust tests.
- [ ] Run: `cargo test dock:: --manifest-path src-tauri/Cargo.toml`

### Task 3: Native accessory window lifecycle

**Files:**

- Create: `src-tauri/src/dock_accessories.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/dock.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/capabilities/default.test.js`

- [ ] Add labels `dock-header` and `dock-editor` and helper functions for
      idempotent create, show, hide, position, and destroy.
- [ ] Build both as transparent, undecorated, non-resizable, always-on-top,
      skip-taskbar WebView windows. Header loads
      `index.html?surface=dock-header`; editor loads
      `index.html?surface=dock-editor`.
- [ ] Keep both hidden until requested. Never register either as an AppBar.
- [ ] On Dock enter/boot restore, resolve the monitor/scale and prepare header.
      On edge change, reposition visible accessories after the strip settles.
- [ ] On Dock exit and shutdown, hide/destroy accessories before normal-window
      restoration and AppBar cleanup complete.
- [ ] Add commands for `show_dock_header`, `hide_dock_header`,
      `show_dock_editor(view, preferredHeight)`, and `hide_dock_editor`, or one
      narrow state command if that produces a cleaner atomic API.
- [ ] Explicitly authorize accessory labels with the smallest useful Tauri
      capability. Update capability guard tests.
- [ ] Run: `npm run test -- src-tauri/capabilities/default.test.js` and
      `cargo test --manifest-path src-tauri/Cargo.toml`.

### Task 4: IPC wrappers and accessory event protocol

**Files:**

- Modify: `src/ipc/commands.js`
- Create: `src/dock/accessoryProtocol.js`
- Create: `src/dock/accessoryProtocol.test.js`
- Create: `src/dock/useDockAccessoryBridge.js`
- Create: `src/dock/useDockAccessoryBridge.test.jsx`

- [ ] Add JS wrappers for every native accessory command; components must not
      call `invoke` directly.
- [ ] Define serializable, versioned snapshot shapes for header/editor and a
      finite semantic action catalog.
- [ ] Add revision comparison and stale-snapshot rejection helpers.
- [ ] In main, listen for accessory `ready`, `action`, and `pointer` events and
      publish the latest state to specific window labels.
- [ ] Validate/normalize action payloads before dispatch. Keep audio-engine IPC
      exclusively in existing `src/ipc/` paths.
- [ ] Ensure bridge listeners clean up across Dock enter/exit and React
      remounts. Test ready replay and stale revisions.
- [ ] Run:
      `npm run test -- src/dock/accessoryProtocol.test.js src/dock/useDockAccessoryBridge.test.jsx`

### Task 5: Route separate React roots

**Files:**

- Modify: `src/main.jsx`
- Create: `src/dock/accessories/DockHeaderApp.jsx`
- Create: `src/dock/accessories/DockHeaderApp.test.jsx`
- Create: `src/dock/accessories/DockEditorApp.jsx`
- Create: `src/dock/accessories/DockEditorApp.test.jsx`
- Create: `src/dock/accessories/useAccessoryClient.js`

- [ ] Select the root from the trusted `surface` initialization value/query.
      Unknown values fall back to `App` only in the main window.
- [ ] Accessory roots initialize theme/layout tokens and then emit `ready`.
- [ ] `useAccessoryClient` listens for snapshots, exposes the newest state, and
      emits semantic actions/pointer presence.
- [ ] Render a quiet loading/transparent state until the first snapshot; never
      mount workspace providers, audio intake, settings, tray, or update hooks
      in accessory roots.
- [ ] Prove each URL mounts only its intended root.
- [ ] Run:
      `npm run test -- src/dock/accessories/DockHeaderApp.test.jsx src/dock/accessories/DockEditorApp.test.jsx src/App.smoke.test.jsx`

### Task 6: Move the Dock header out of the strip

**Files:**

- Move/adapt: `src/dock/DockControls.jsx` ->
  `src/dock/accessories/DockHeader.jsx`
- Move/adapt: `src/dock/DockControls.test.jsx` ->
  `src/dock/accessories/DockHeader.test.jsx`
- Modify: `src/dock/DockStrip.jsx`
- Modify: `src/dock/DockStrip.test.jsx`
- Modify: `src/App.jsx`

- [ ] Render full-width 44px header with left `SourceTransportCluster`, flexible
      notice region, and the existing right-side action order.
- [ ] Keep LIVE source locked, icon tooltips, Windows-only Reserve action,
      Top/Bottom action, and Restore behavior unchanged.
- [ ] Convert clicks into accessory semantic actions rather than direct props.
- [ ] Remove the overlay controls and in-strip editor view state from
      `DockStrip`. The strip renders meters plus the health dot only.
- [ ] Strip pointer enter/leave goes to the main accessory coordinator.
- [ ] Update App assembly to publish header snapshots and dispatch its actions
      through existing callbacks.
- [ ] Test exact header ordering and verify the strip never renders header or
      editor controls.
- [ ] Run:
      `npm run test -- src/dock/accessories/DockHeader.test.jsx src/dock/DockStrip.test.jsx src/App.smoke.test.jsx`

### Task 7: Cross-window hover/focus coordinator

**Files:**

- Create: `src/dock/accessoryVisibility.js`
- Create: `src/dock/accessoryVisibility.test.js`
- Create: `src/dock/useDockAccessoryVisibility.js`
- Create: `src/dock/useDockAccessoryVisibility.test.jsx`
- Modify: `src/App.jsx`

- [ ] Model pointer presence for `strip`, `header`, and `editor`, plus
      `editorOpen`, `headerVisible`, and the 300ms hide timer.
- [ ] Entering strip/header shows header and cancels hide. Leaving both starts
      one timer. An open editor locks header visible.
- [ ] Editor Escape/Done/outside-focus closes editor and returns to hover rules.
- [ ] Dock exit cancels timers and hides both windows immediately.
- [ ] Serialize native show/hide calls so rapid cross-window movement cannot
      apply an old hide after a newer show.
- [ ] Test fake-timer boundary cases and IPC rejection notices.
- [ ] Run:
      `npm run test -- src/dock/accessoryVisibility.test.js src/dock/useDockAccessoryVisibility.test.jsx`

### Task 8: Vertical Modules editor

**Files:**

- Replace: `src/dock/editors/DockModulesEditor.jsx`
- Replace: `src/dock/editors/DockModulesEditor.test.jsx`
- Create: `src/dock/editors/DockEditorShell.jsx`
- Create: `src/dock/editors/DockEditorShell.test.jsx`
- Modify: `src/dock/registry.jsx`
- Modify: `src/dock/registry.test.js`

- [ ] Build the 380-420px single-column tool surface with title, vertical
      module rows, drag handles, enabled switches/checkboxes, settings icons,
      and Done.
- [ ] Add registry metadata indicating whether a module has settings and its
      settings family. Transport has no settings action.
- [ ] Keep enabled order semantics; disabled rows remain in catalog order.
- [ ] Emit actions for toggle, reorder, open settings, and Done. Do not access
      stores directly from the editor WebView.
- [ ] Keep stable dimensions and scroll within the editor when monitor height
      is constrained.
- [ ] Run:
      `npm run test -- src/dock/editors/DockModulesEditor.test.jsx src/dock/editors/DockEditorShell.test.jsx src/dock/registry.test.js`

### Task 9: Shared settings primitives and Dock settings drill-in

**Files:**

- Refactor: `src/components/PanelSettingsContent.jsx`
- Preserve: `src/components/PanelSettingsContent.test.jsx` if present and
  `src/components/PanelSettingsMenu.test.jsx`
- Create: `src/dock/editors/DockModuleSettings.jsx`
- Create: `src/dock/editors/DockModuleSettings.test.jsx`
- Modify: `src/dock/accessories/DockEditorApp.jsx`

- [ ] Extract reusable settings primitives/sections from
      `PanelSettingsContent` without changing normal panel behavior or copy.
- [ ] Build Dock-specific sections only for controls that affect compact Dock
      renderers. Do not expose dialogue/VAD or unrelated panel-only options.
- [ ] Implement Modules -> Settings drill-in with Back, module title, Reset,
      and normalized update actions.
- [ ] Avoid nested Radix popovers that can escape the editor bounds; selects
      and inline details must fit or scroll within the editor surface.
- [ ] Test Level, Loudness, Spectrum, Stats, Waveform, Correlation, and
      Spectrogram settings visibility plus Transport's no-settings state.
- [ ] Run:
      `npm run test -- src/components/PanelSettingsMenu.test.jsx src/dock/editors/DockModuleSettings.test.jsx`

### Task 10: Make Dock renderers consume Dock controls

**Files:**

- Modify: `src/dock/modules/DockLevel.jsx` and test
- Modify: `src/dock/modules/DockLoudness.jsx` and test
- Modify: `src/dock/modules/DockSpectrum.jsx` and test
- Modify: `src/dock/modules/DockCorrelation.jsx` and test
- Modify: `src/dock/modules/DockStats.jsx` and test
- Modify: `src/dock/modules/DockWaveform.jsx` and test
- Modify: `src/dock/modules/DockSpectrogram.jsx` and test
- Modify: `src/dock/DockStrip.jsx`
- Modify: `src/App.jsx`

- [ ] Pass each renderer only its normalized Dock controls plus shared runtime
      data. Remove reliance on the first/normalized workspace panel controls.
- [ ] Implement every control exposed in Task 9; hide unsupported settings
      until the renderer honors them.
- [ ] Keep channel labels/layout and global measurement semantics shared.
- [ ] Add regression tests proving workspace panel-control changes do not alter
      Dock output and Dock updates do not mutate workspace state.
- [ ] Run all `src/dock/modules/*.test.jsx` tests plus `src/App.smoke.test.jsx`.

### Task 11: Derive analysis requests from Dock controls

**Files:**

- Modify: `src/dock/dockAnalysisRequest.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`
- Modify: `src/App.jsx`

- [ ] Replace fixed `DEFAULT_CONTROLS` requests with normalized Dock spectrum/
      spectrogram controls.
- [ ] Derive request key, channel, view, smoothing, and tilt from the same
      controls passed to renderers.
- [ ] Preserve max-request eviction behavior while docked and restore workspace
      requests unchanged on exit.
- [ ] Ensure changing controls atomically updates request and snapshot lookup
      keys so no module reads the old/default key.
- [ ] Run:
      `npm run test -- src/dock/dockAnalysisRequest.test.js src/dock/modules/DockSpectrum.test.jsx src/dock/modules/DockSpectrogram.test.jsx`

### Task 12: Normal-size Presets editor

**Files:**

- Refactor: `src/components/PresetsPopover.jsx`
- Preserve/extend: `src/components/PresetsPopover.test.jsx`
- Replace: `src/dock/editors/DockPresetsRow.jsx`
- Replace: `src/dock/editors/DockPresetsRow.test.jsx`
- Modify: `src/dock/accessories/DockEditorApp.jsx`

- [ ] Extract a presentation component from `PresetsPopoverContent` that works
      in both the normal popover and Dock editor shell.
- [ ] Preserve apply, active/dirty, save, update, rename, delete confirmation,
      and literal copy/order.
- [ ] Dock editor uses normal vertical spacing and Done/Escape dismissal; it
      emits actions to main instead of mounting `usePresets` itself.
- [ ] Ensure destructive confirmations stay inside editor bounds and hold the
      editor open.
- [ ] Run:
      `npm run test -- src/components/PresetsPopover.test.jsx src/dock/editors/DockPresetsRow.test.jsx`

### Task 13: Preset controls integration and assembly cleanup

**Files:**

- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/AppShell.jsx`
- Delete obsolete in-strip editor code only after replacements are covered.

- [ ] Capture `dock.controlsByModuleId` with modules and edge.
- [ ] Normalize old presets without controls and old presets containing only
      `statsIds`.
- [ ] Apply controls before entering Dock. Preserve normal-preset exits and
      window-bound behavior.
- [ ] Include Dock controls in dirty comparison without persisting accessory
      visibility or navigation.
- [ ] Remove obsolete `DockStrip` editor props/state and keep App assembly
      readable through a focused Dock coordinator hook if needed.
- [ ] Run:
      `npm run test -- src/hooks/usePresets.test.jsx src/App.smoke.test.jsx src/dock/DockStrip.test.jsx`.

### Task 14: Full gate, documentation, and native manual matrix

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/architecture-maps/frontend-module-map.md` if the map covers Dock
- Update this plan/spec status only after verification.

- [ ] Document the three-window Dock form, event ownership boundary,
      persistence ownership, and AppBar-only meter rule.
- [ ] Run `npm run check` and require exit code 0.
- [ ] Windows manual matrix:
      Bottom/Top x Reserve Off/On; enter/exit; header hover bridge; Modules and
      Presets; settings Back/Reset; Escape/outside dismissal; maximized-window
      geometry remains stable; work area releases on exit.
- [ ] Repeat key geometry at 100% and 150% scaling and on a secondary monitor
      with a different scale if available.
- [ ] Confirm transparent/non-rectangular unused areas do not intercept clicks.
- [ ] Confirm restart while docked restores only meter/header readiness, never
      an open editor and never auto-starts capture.
- [ ] macOS manual: header/editor placement, hide timing, Top/Bottom, and no
      Reserve control.
- [ ] Commit in narrow, English commits; final implementation commit must not
      start with `@`.

## Deferred after this plan

- Reserving accessory space; adjustable Dock/editor dimensions; detachable or
  draggable editor; left/right Dock; FILE mode in Dock; animation polish;
  syncing Dock display controls to workspace panel instances.

