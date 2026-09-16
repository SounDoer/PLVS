# Presets Toolbar Popover - Move Preset Management out of Settings

**Date:** 2026-06-18
**Status:** Approved
**Revises:** `2026-06-18-presets-redesign-design.md` (the "Toolbar quick-switch / quick-apply of presets" item that spec explicitly deferred as out of scope, and the "Settings owns presets" placement decision).

## Summary

Move the entire Presets management surface out of `SettingsPanel` and into a new
toolbar popover. The popover lives in the right-side toolbar between the Modules
popover and the Settings button, and is the single place where presets are listed,
created, applied, updated, renamed, and deleted. `SettingsPanel` no longer has a
Presets block.

As part of this work the Modules popover's toolbar tooltip is renamed from
"Layout & Modules" to "Modules" (the popover already shows modules only; the old
label is stale).

A preset's data model, persistence domain (`plvs:presets`), the `usePresets`
orchestration hook, and the footer active-preset label are all unchanged. This is
a UI relocation, not a data-architecture change.

## Motivation

- A preset is a **view snapshot** (layout / modules / panel controls / window
  geometry). It is a view concept, not an application configuration. Settings is
  for application configuration (theme, reference LUFS, shortcuts, device
  behaviour, close action). Keeping preset management in Settings was a
  stop-gap from when no toolbar entry existed; it is no longer the right home.
- Having the same concept editable in two places (toolbar quick-switch vs.
  Settings full CRUD) is redundant and confusing. A single ownership point is
  cleaner.
- Quick-switching presets is a frequent, view-level action. It belongs one click
  away in the toolbar, next to the other view controls (Modules popover), not
  behind the Settings sheet.

## What stays the same

- **`usePresets` hook** (`src/hooks/usePresets.js`): `save / apply / update /
  rename / remove` API is reused verbatim. No new hook, store, or IPC.
- **`presetsStore`** (`plvs:presets` domain, shape `{ list, activeId }`):
  unchanged.
- **Preset shape**: still a view snapshot (`tree`, `visibleModules`,
  `panelControls`, `windowBounds?`, `windowPinned?`). No `builtin` field.
- **Footer active-preset label** (`src/App.jsx`): unchanged. It reads
  `usePresets().activeId` and does not depend on the Settings UI.
- **`WorkspaceContext` divergence clearing** of `presetsStore.activeId` on manual
  view edits: unchanged.

## Toolbar popover design

### Placement

Insert between the Modules popover and the Settings button. New right-side
toolbar order:

```
[Clear] [AudioDevice] [Pin] [Modules] [Presets] [Settings]
```

Rationale: applying a preset re-lays-out panels and reconfigures modules, so
Presets sits adjacent to the Modules popover. Settings remains the right-most
"application configuration" boundary.

### Trigger button

Same `IconButton` pattern as the neighbouring Modules popover trigger.

- **Icon:** `Bookmark` from `lucide-react`.
- **Tooltip:** `"Presets"`.
- **Active highlight:** when a preset is active (`activeId` is non-null), render
  the icon in `text-foreground` (matching the Pin button's active treatment) so
  the user can see at a glance that a preset is driving the current view.

### Popover content

A dedicated `PresetsPopoverContent` component (new file
`src/components/PresetsPopover.jsx`), wired through a `Popover` wrapper in
`App.jsx` exactly like `VisibilityPopoverContent`. It receives the `presets`
object from `usePresets()` via props.

Layout, top to bottom:

1. **Header label:** `"Presets"` (matches the Modules popover's `"Modules"`
   header style).
2. **Create row:** a text input (`placeholder="New preset name"`) + a `Save`
   `Button`. Enter submits. Disabled when the input is empty. This is always
   visible, so a first-time user can save the current view without going
   anywhere else.
3. **List / empty state:**
   - When `list` is empty: a muted hint `"No presets yet. Save the current view
     to start."`
   - Otherwise: a vertical list of rows, one per preset.

### Preset row

Each row carries the full CRUD surface without feeling crowded:

- **Whole-row click = Apply.** The entire row is a button that calls
  `presets.apply(preset.id)`. This makes the highest-frequency action (switching)
  a single click anywhere on the row, matching a "switcher" mental model.
- **Active marker:** a small dot at the row start. Filled (`bg-primary`) for the
  active preset, faint (`bg-muted-foreground/20`) otherwise. The active preset's
  dot is always visible.
- **Row-tail action icons** (Update / Rename / Delete): three small icon-only
  buttons grouped at the row end.
  - Icons: `RefreshCw` (Update), `Pencil` (Rename), `Trash2` (Delete).
  - **Visibility:** shown on row hover (CSS `group-hover`); hidden when the row
    is not hovered and not being edited. This keeps inactive, un-hovered rows
    clean - just name + dot.
  - **`stopPropagation`:** each icon button stops propagation on click so that,
    e.g., clicking Delete does not also trigger the row's Apply.
  - Delete uses `text-destructive` on hover.
- **Rename inline edit:** clicking the Rename icon swaps the row's name span for
  an input pre-filled with the current name, plus `Check` (save) and `X`
  (cancel) icon buttons. Enter saves, Escape cancels. While a row is in edit
  state the row-tail icons are replaced by these two confirm icons, and the
  whole-row Apply is suppressed for that row.

### Empty list

The create row (input + Save) is always present, so the empty state is just the
create row plus the muted hint. No separate empty-state component needed.

## Removals from SettingsPanel

In `src/components/SettingsPanel.jsx`:

- Delete the `DEFAULT_PRESETS` constant.
- Delete the `presets` prop (and its default).
- Delete the `presetName`, `editingPresetId`, `presetRenameDrafts` state.
- Delete the derived `presetControls` / `presetList`.
- Delete the handlers: `handleSavePreset`, `startRenamePreset`,
  `cancelRenamePreset`, `handleRenamePreset`.
- Delete the Presets block in the sheet body: the `<Label>Presets</Label>` grid
  `div` and the `<Separator />` that precedes it. Keep the Separator that
  follows (it still separates the Clear-shortcut block from Appearance), unless
  it becomes adjacent to another Separator - then drop the now-redundant one.

In `src/App.jsx`:

- Stop passing `presets={presets}` to `<SettingsPanel>`. The `usePresets()` call
  stays (its result is now consumed by the toolbar popover and the footer).

In `src/components/SettingsPanel.test.jsx`:

- Delete every preset-related test case (save / apply / update / rename / cancel
  / delete / marks active preset). These behaviours are re-asserted in the new
  `PresetsPopover` tests.

## Modules popover rename

In `src/App.jsx`, change the Modules popover trigger's `tip` from
`"Layout & Modules"` to `"Modules"`. The popover content already only toggles
module visibility (the old layout-preset section was removed by the parent
spec), so the old label is stale. No other "Layout & Modules" strings exist in
user-facing UI.

## Relationship to the parent spec

`2026-06-18-presets-redesign-design.md` made two decisions this spec revises:

1. **"Settings owns presets"** (its Summary and "Rationale for a separate
   domain"). This spec moves ownership to the toolbar. The `presetsStore` domain
   and `usePresets` hook remain; only the UI surface moves. The "Settings owns
   presets" sentence should be read as "presets are a user-owned, settings-grade
   persisted concept" (i.e. not a workspace-internal artifact) - the *storage*
   ownership is unchanged; the *UI* ownership moves to the toolbar.
2. **"Toolbar quick-switch / quick-apply of presets - deferred (look again
   later)"** (its Out of scope). This is now in scope and implemented.

## Out of scope

- Capturing global settings (theme, reference LUFS, close behaviour, clear
  shortcut, window pin) in a preset - presets remain view-only (unchanged from
  parent spec).
- Reordering presets in the list (drag-and-drop).
- Import/export of presets (covered by future `exportAll` UI work).
- Keyboard shortcut to cycle presets.
- A "manage in Settings" jump link - not needed, since Settings no longer has a
  presets section.

## Testing notes

- `PresetsPopover.test.jsx` (new): cover empty-state hint, saving calls
  `presets.save(name)` and clears the input, whole-row click calls
  `presets.apply(id)`, Update icon calls `presets.update(id)`, Rename icon
  enters edit mode and `Check` calls `presets.rename(id, name)`, `X` cancels
  without calling rename, Delete icon calls `presets.remove(id)` and does **not**
  call apply (stopPropagation), active preset row is marked, row-tail icons are
  hidden until hover (assert via `group-hover` class presence or
  `pointer-events`/`opacity` rather than true hover in jsdom).
- `SettingsPanel.test.jsx`: assert the Presets label and all preset controls are
  gone; assert `presets` prop is no longer accepted (or silently ignored - pick
  whichever is cheaper; removing the prop is cleanest).
- `App.toolbar.test.js`: add a source assertion that the toolbar renders a
  Presets popover trigger (e.g. asserts `Bookmark` import and `"Presets"` tip),
  and that the Modules tip is now `"Modules"` (not `"Layout & Modules"`).
- `App.jsx` footer tests: unchanged (active-preset label still reads
  `usePresets().activeId`).
