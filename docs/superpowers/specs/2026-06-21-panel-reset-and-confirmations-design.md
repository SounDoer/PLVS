# Panel-level Reset & Inline Confirmation — Design

Date: 2026-06-21
Status: Approved (brainstorm), pending implementation plan

## Background

PLVS has grown a lot of user customization (theme selection, custom themes,
custom presets, per-instance panel controls, channel labels, shortcuts, panel
layout). There is currently **no consistent "restore to default" affordance**.
What exists is sparse and inconsistent:

- Settings · Channel Labels — `Reset to Auto` (full reset, instant)
- Settings · Clear shortcut — `Reset` (full reset, instant)
- Stats popover — `Reset order` (resets **order only**, not visibility, instant)
- Everything else (per-panel controls, layout, window geometry) — none

A whole-app `resetAll()` exists in `src/persistence/index.js` but has no UI entry
point. A future "global restore to default" / "wipe all data" feature is planned
separately.

This design covers the **panel layer only** — the granular, in-context resets a
user reaches for day to day. The global feature is explicitly out of scope and
will be designed later (it can compose these primitives).

A second, related gap surfaced during brainstorming: the genuinely
**irreversible deletes** (delete preset / delete custom theme / delete panel)
currently have **no confirmation at all**, while we were about to add
confirmation to the less-destructive resets. That inconsistency is corrected
here — deletes are brought into scope and given the same confirmation treatment.

## Scope

Seven destructive actions, all gated behind a **unified inline confirmation**
pattern:

| # | Category | Action | Location |
|---|----------|--------|----------|
| 1 | Reset | Clear shortcut → `CmdOrCtrl+K` | Settings panel |
| 2 | Reset | Channel labels → auto | Settings panel |
| 3 | Reset | Stats: visibility **and** order → default | Stats popover (`PanelHeaderControls`) |
| 4 | Reset | Workspace layout: tree + panels + panel controls + names → default | Modules popover (`WorkspaceToolbar`) |
| 5 | Delete | Delete preset | Presets popover |
| 6 | Delete | Delete custom theme | Settings panel |
| 7 | Delete | Delete panel | Modules popover |

**Out of scope:**

- Global "Reset Preferences" / "Wipe All Data" (separate future design).
- Window geometry (`windowBounds`) reset — belongs to the global feature.
- Per-chip resets on individual panels (peak / loudness / spectrum / vectorscope
  control chips) — deferred to the global feature; the Modules layout reset (#4)
  already returns every panel's chips to default in one shot.

## Label unification

All four reset buttons read exactly **`Reset`**. The surrounding section
(Stats popover, Modules popover, the Clear/Channel-labels rows in Settings)
provides the scope context, so a bare `Reset` is unambiguous.

- `Reset to Auto` (channel labels) → `Reset`
- `Reset order` (stats) → `Reset`

## Behavior changes (functional)

Two of the seven are not just "wrap existing behavior in a confirm" — they
change what the action does:

### #3 Stats reset (was "Reset order")

Currently resets `loudnessStatsOrder` only. New behavior resets **both** fields
of the active stats panel instance to the defaults in `DEFAULT_PANEL_CONTROLS`:

- `loudnessStatsOrder` → `[...LOUDNESS_STATS_ORDER]`
- `loudnessStatsVisibleIds` → `DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds`

Scope is the **single panel instance** (per-instance `panelControlsById`),
consistent with the existing per-instance control model. Routed through the
existing `onPanelControlsChange(normalizePanelControls(...))` path.

### #4 Modules layout reset (new)

A new `Reset` control in the Modules popover (`WorkspaceToolbar`), placed near
`Add Panel`. Restores the workspace to `DEFAULT_WORKSPACE_STATE` in full:

- `tree`, `panelsById`, `panelOrder`, `panelControlsById` → defaults
- Custom panel names (`customTitle`) are cleared (part of default `panelsById`)
- `fullscreenId` stays `null` (transient, never restored)
- Clears the active preset (`presetsStore.patch({ activeId: null })`), matching
  every other layout-mutating workspace action.

Requires a new workspace reducer action (e.g. `resetWorkspace`) that replaces
state with `DEFAULT_WORKSPACE_STATE`, bound through `WorkspaceContext` so it runs
`clearActivePreset` like the other layout mutations.

The remaining five actions (#1, #2, #5, #6, #7) keep their current effect and
only gain the confirmation step.

## Inline confirmation pattern

### Why inline, not modal

- The app's only existing confirmation is `CloseConfirmDialog`, a **modal** — but
  that intercepts an **app-lifecycle event** (quit / minimize-to-tray), a
  different category from a button-triggered action.
- Most actions here are **row-level icon/text controls inside popovers**. A
  centered modal per row is heavy and forces the popover to close.
- The product already has an **inline commit/cancel (✓/✗) vocabulary** — the
  rename flow in the Modules and Presets popovers. Inline confirmation reuses
  that vocabulary instead of introducing a new modal flow.

Resulting mental model: **modal = app-level event interception; inline =
in-context destructive actions.** `CloseConfirmDialog` is left unchanged.

### Contract

A small reusable primitive (e.g. a `useInlineConfirm` hook) manages a two-step
"arm → confirm" interaction for a single control:

- **Idle:** the trigger renders normally (`Reset` text button, or a trash icon).
- **First activation (arm):** the action does **not** execute. The control morphs
  in place into a confirm/cancel affordance using the existing ✓/✗ idiom:
  - icon triggers (delete preset / delete panel): trash → ✓ (confirm) / ✗ (cancel)
  - text triggers (`Reset`, delete theme button): label → a confirm action +
    a cancel ✗ alongside it
- **Confirm:** runs the underlying action, returns to idle.
- **Cancel:** `Escape`, the explicit ✗, or the control unmounting (e.g. popover
  closing) returns to idle with no effect.

Arming state is **local per control** — independent, no shared global state.

### Disabled states (preserved)

- Channel-labels reset stays disabled when there is no override
  (`!channelLabelHasOverride`); arming is only possible when there is something
  to reset.
- Clear-shortcut reset stays disabled when `!clearReady`.
- Stats reset and Modules reset are always enabled (no cheap "already at default"
  check; acceptable per brainstorm).

## Components touched

- `src/components/SettingsPanel.jsx` — Clear reset (#1), Channel-labels reset
  (#2), delete custom theme (#6) wired through inline confirm; relabel #2.
- `src/components/PanelHeaderControls.jsx` — Stats reset (#3): relabel, reset
  both fields, inline confirm.
- `src/workspace/WorkspaceToolbar.jsx` — new Modules layout reset (#4) and delete
  panel (#7) through inline confirm.
- `src/components/PresetsPopover.jsx` — delete preset (#5) through inline confirm.
- `src/workspace/reducer.js` + `src/workspace/WorkspaceContext.jsx` — new
  `resetWorkspace` action that clears the active preset.
- New inline-confirm primitive (hook and/or small presentational helper) in a
  shared location (`src/hooks/` or `src/components/`).

`CloseConfirmDialog` and `resetAll()` are not modified.

## Testing

For each of the seven actions:

- First activation **arms** (shows confirm/cancel) and does **not** mutate state.
- Confirm runs the underlying effect.
- Cancel (✗ and `Escape`) disarms with no effect.

Plus the two functional changes:

- Stats reset restores **both** visibility and order to default for that
  instance, leaving other instances untouched.
- Modules reset restores `tree` / `panelsById` / `panelOrder` /
  `panelControlsById` to `DEFAULT_WORKSPACE_STATE`, clears custom names, and
  clears the active preset.

Existing tests that assume instant reset/delete
(`SettingsPanel.test.jsx`, `WorkspaceToolbar.test.jsx`, `PresetsPopover.test.jsx`,
`PanelHeaderControls.test.jsx`) are updated to go through the confirm step.
