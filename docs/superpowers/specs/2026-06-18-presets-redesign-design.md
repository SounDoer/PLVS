# Presets Redesign — User-Created View Snapshots in Settings

**Date:** 2026-06-18
**Status:** Approved
**Spec depends on:** `2026-06-17-persistence-unification-design.md` (domain stores, `settings.windowBounds`, Rust first-paint injection, `window_state.rs` clamp helper)

## Summary

Replace the current layout-bound preset system with **user-created view snapshots** managed
in Settings. The three built-in presets and the toolbar's Presets section are removed; the
module popover becomes modules-only. A preset is now a named snapshot of the **view state**
that also captures the PLVS window's position and size, so applying a preset both re-lays-out
the panels and moves/resizes the window.

A preset is no longer a `workspace` artifact: it spans the `workspace` domain (layout/modules/
panel chips) and the `settings` domain (window geometry), and it is a Settings-managed list.
It therefore gets its own persistence domain and an orchestration layer above the pure
workspace reducer.

## Motivation

- New requirement: a saved preset must also restore the window's position and size.
- That pushes a preset across two persistence domains and makes it a cross-cutting,
  user-owned concept rather than a layout sub-feature. Keeping it inside the workspace
  reducer (a pure function with no access to window geometry) no longer fits.
- The built-in presets and the toolbar Presets UI become redundant once presets are fully
  user-created and managed in Settings. The toolbar's module popover should just be modules.

## Concept and preset shape

A preset is a **view snapshot** (no global settings such as theme or reference LUFS — those
remain single global values and are never overwritten by applying a preset).

```js
/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   windowBounds: { x: number, y: number, width: number, height: number, isMaximized: boolean },
 *   tree: TreeNode,            // layout, including split sizes
 *   visibleModules: ModuleId[],
 *   panelControls: PanelControls,  // per-panel chip selections
 * }} Preset
 */
```

No `builtin` field — every preset is user-created.

## Storage — a new `presets` domain

Add a third domain via the existing `createDomainStore` factory, alongside `settings` and
`workspace`:

```js
// persistence/index.js
export const presetsStore = createDomainStore({ name: "plvs:presets" });
// blob shape: { list: Preset[], activeId: string | null }
```

`presetsStore` joins `exportAll` / `resetAll`. In production it maps to a top-level
`presets` key in `plvs-settings.json`; in dev/browser it uses localStorage. The Rust
first-paint injection object gains one line (`"plvs:presets": presets`) so the store hydrates
without an async round-trip, though presets do not affect the first paint (they only drive the
Settings UI and the footer label).

**Rationale for a separate domain.** A preset references a subset of both `workspace` (view)
and `settings` (window), and is a Settings-managed list — it belongs to neither existing
domain. A dedicated domain keeps `workspaceReducer` pure and matches the "Settings owns
presets" mental model.

## Removals

- **`constants.js`** — delete the `BUILTIN_PRESETS` array. **Keep** `DEFAULT_TREE` and
  `DEFAULT_WORKSPACE_STATE`: the app still needs a baseline layout on first launch / when no
  preset is applied. It is simply no longer labelled a "preset" and does not appear in the
  list.
- **`workspace` domain / state** — remove `customPresets` and `activePresetId` from
  `WorkspaceState` and `DEFAULT_WORKSPACE_STATE`. The `activePresetId` concept moves to
  `presets.activeId`.
- **`reducer.js`** — delete `SAVE_PRESET` and `APPLY_PRESET` cases and their bound actions
  (`saveCurrentAsPreset`, `applyPreset`). `SET_TREE` / `MOVE_TAB` no longer clear
  `activePresetId` (it no longer lives in workspace; see "Active preset & footer").
- **`WorkspaceToolbar.jsx`** — remove `PresetDropdown` and the Presets section; keep
  `VisibilityPopover` (modules only). Remove the toolbar render site of `PresetDropdown` in
  `App.jsx`.
- **`WorkspaceContext.initState`** — drop the `customPresets` rehydration line.

## Reducer change — `SET_VIEW`

Applying a preset's view portion is one atomic reducer action (replacing the deleted
`APPLY_PRESET`), keeping the reducer pure:

```js
case "SET_VIEW": {
  const { tree, visibleModules, panelControls } = action.payload;
  return {
    ...state,
    tree,
    visibleModules,
    panelControls: normalizePanelControls(panelControls),
    fullscreenId: null,
  };
}
```

Bound action: `setView({ tree, visibleModules, panelControls })`.

## Orchestration — `usePresets`

A new hook owns the cross-cutting actions, because the window side is an imperative
side-effect and the snapshot reads across domains. It reads the live workspace view from
`useWorkspaceStore()` and persists the list through `presetsStore`.

| Action | Behaviour |
| --- | --- |
| `save(name)` | Capture `{ tree, visibleModules, panelControls }` from workspace + live `windowBounds` (see below) → append `{ id: \`preset-${Date.now()}\`, name, ... }` to `list`; set `activeId`. |
| `apply(id)` | `setView({ tree, visibleModules, panelControls })` + invoke Rust `apply_window_bounds(windowBounds)`; set `activeId = id`. |
| `update(id)` | Re-capture current view + live `windowBounds` into the existing entry (keep `id`/`name`, replace the four snapshot fields); set `activeId = id`. |
| `rename(id, name)` | Replace `name` only. |
| `remove(id)` | Drop from `list`; if it was active, `activeId = null`. |

**Capturing window bounds (`save` / `update`).** Read the **live** window via the new Rust
command `current_window_bounds()` (accurate; avoids the ~400 ms debounce lag of
`settings.windowBounds`). In dev/browser (no Tauri), fall back to `settings.windowBounds` if
present, else omit `windowBounds` from the saved preset.

**Applying window bounds (`apply`).** Invoke Rust `apply_window_bounds(bounds)`; a no-op in
the browser. If a preset has no `windowBounds` (dev-saved), skip the window step and only
apply the view.

## Rust — two new commands

In `src-tauri`, reusing `window_state.rs`:

- `current_window_bounds() -> WindowBounds` — read the focused window's outer position, inner
  size, and maximized flag into the existing `WindowBounds` shape.
- `apply_window_bounds(bounds: WindowBounds)` — `clamp_to_visible` against current monitors,
  then `set_position` / `set_size`; `maximize()` when `isMaximized`, else `unmaximize()`
  first if currently maximized. Off-screen safety stays in the single `clamp_to_visible`
  home.

These are invoked from `usePresets` via the existing IPC `invoke` path.

## Footer & active preset

- Footer adds a `Preset · <name>` item (using the existing `SHELL_FOOTER` divider style),
  showing `presets.activeId`'s name, or `—` when `activeId` is null.
- **Divergence heuristic (v1):** clear `activeId` to `null` on any manual view edit
  (`MOVE_TAB`, `SET_TREE`, `RESIZE_CHILDREN`, `TOGGLE_MODULE_VISIBLE`, `SET_PANEL_CONTROLS`),
  so the footer falls back to `—` once the user diverges. This reuses today's
  "edit clears the active preset" behaviour. **Window drags do not clear `activeId`** — window
  geometry is soft state, updated debounced on the Rust side, and tracking it would make the
  footer flicker.

  Since `activeId` now lives in `presetsStore` (not the workspace reducer), the clearing is
  done in the orchestration layer / context, not inside `workspaceReducer` — the reducer stays
  unaware of presets. The view-edit bound actions notify `usePresets` (or a small shared
  effect) to null `activeId`.

## Settings UI

A new "Presets" section in `SettingsPanel.jsx` (consistent with the existing
`Separator`-delimited blocks):

- **List** of saved presets. Each row: name + actions **Apply**, **Update** (overwrite with
  current view), **Rename** (inline edit), **Delete**. The active preset is marked.
- **Save as new** control: name input → `save(name)`.
- Empty state when `list` is empty: short hint that presets capture the current layout,
  modules, panel options, and window size/position.

`SettingsPanel` gains the `usePresets` values via props (wired in `App.jsx`, matching how the
other settings groups are passed in).

## Migration

- New `plvs:presets` key in `plvs-settings.json` (and the Rust injection object).
- Old `workspace.customPresets` / `workspace.activePresetId` are **dropped** (pre-1.0, no
  migration — consistent with the persistence-unification decision). A one-shot best-effort
  removal of those fields from the persisted `workspace` blob on first run keeps the file
  tidy; it is a few lines, not a translation layer.

## Out of scope

- Toolbar quick-switch / quick-apply of presets — deferred ("look again later").
- Capturing global settings (theme, reference LUFS, close behaviour, clear shortcut, window
  pin) in a preset — presets are view-only.
- Reordering presets in the list.
- Import/export of presets (covered by the future `exportAll` UI work).

## Testing notes

- `presetsStore`: round-trips `{ list, activeId }`; joins `exportAll`/`resetAll`.
- Reducer: `SET_VIEW` atomically sets tree/visibleModules/panelControls and resets
  `fullscreenId`; no `SAVE_PRESET`/`APPLY_PRESET` remain; `customPresets`/`activePresetId`
  absent from `DEFAULT_WORKSPACE_STATE` and `WorkspaceState`.
- `usePresets`: `save` captures view + window bounds and sets `activeId`; `apply` calls
  `setView` and `apply_window_bounds` and sets `activeId`; `update` overwrites the four
  snapshot fields, preserving `id`/`name`; `rename` changes only `name`; `remove` drops the
  entry and nulls `activeId` when it was active. Browser fallback: `save` omits/derives
  `windowBounds`, `apply` skips the window step.
- Window-bounds capture uses the live Rust read, not `settings.windowBounds`.
- Footer: shows the active preset name; `—` when none; a manual view edit nulls `activeId`;
  a window drag does not.
- Rust: `apply_window_bounds` clamps an off-screen rectangle onto a visible monitor and
  restores the maximized flag; `current_window_bounds` returns the live outer/inner geometry.
- First-run cleanup removes the orphaned `customPresets`/`activePresetId` workspace fields and
  is idempotent.
