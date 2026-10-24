# Configurable Transport and Snapshot Shortcuts

**Date:** 2026-10-23
**Status:** Approved

## Summary

Replace the Clear-specific shortcut implementation with one configurable shortcut system and add
two default actions:

| Action          | Default accelerator     | Default global scope |
| --------------- | ----------------------- | -------------------- |
| Start / Stop    | `CmdOrCtrl+Shift+Space` | Off                  |
| Live / Snapshot | `CmdOrCtrl+Shift+L`     | Off                  |
| Clear           | `CmdOrCtrl+K`           | Off                  |

Start / Stop controls only Live capture. Live / Snapshot controls only the displayed Live position.
The two axes remain independent: stopping capture does not leave Snapshot, and returning to Live
does not start capture. The new actions never operate on FILE or switch the selected source.

Every action keeps one accelerator that always works while PLVS is focused and an independent
Global switch that registers the same accelerator system-wide. All three accelerators are
customizable, removable and resettable to their built-in defaults.

## Goals

- Give the two common hands-off metering operations default, discoverable shortcuts.
- Preserve stable action meaning instead of emulating the context-sensitive primary button.
- Keep transport state and display state orthogonal.
- Reuse the existing Settings rows, shortcut recorder, reset confirmation and switch.
- Replace the Clear-only preference, hook, registration and routing paths with an action catalogue
  that can accept later shortcuts without another parallel implementation.
- Preserve an existing user's customized Clear accelerator and Global choice.
- Keep the current single-registration, most-recently-focused-workbench behavior across multiple
  PLVS workbenches.

## Non-goals

- Separate Start Live and Stop Live bindings.
- FILE analysis shortcuts or implicit source switching.
- Changing the GUI primary button, transport pill or chart gestures.
- A bare Space binding. Configurable accelerators continue to require at least one modifier.
- Per-workbench shortcut preferences. Shortcut configuration remains identity-wide.
- Changing what Clear clears. This work generalizes its configuration and dispatch infrastructure
  while preserving its current business action.

## Action semantics

### Start / Stop

Start / Stop is a Live-only toggle with a stable meaning independent of what the primary transport
button currently displays.

| Current state                                         | Result                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Source is LIVE, lifecycle is `stopped` or `error`     | Start Live capture through the existing asynchronous controller. |
| Source is LIVE, lifecycle is `running`                | Stop Live capture and retain measurement data.                   |
| Source is LIVE, lifecycle is `starting` or `stopping` | No-op.                                                           |
| Source is FILE, including active FILE analysis        | No-op.                                                           |

The action does not clear measurement data, change source, or change Snapshot selection. In
particular, Start / Stop while Snapshot is active changes the background capture lifecycle and
leaves the frozen display in place.

The shortcut calls a dedicated business action. It must not call `onStartClick` or synthesize a
click on the primary control because that control returns to Live when Snapshot is selected.

### Live / Snapshot

Live / Snapshot is a Live-only display toggle.

| Current state                                        | Result                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Source is LIVE, no Snapshot, retained history exists | Select `offsetSec: 0`, freezing the latest complete retained Live frame. |
| Source is LIVE, Snapshot selected                    | Clear the selection and publish the latest complete Live frame.          |
| Source is LIVE, no Snapshot, no retained history     | No-op.                                                                   |
| Source is FILE                                       | No-op.                                                                   |

Capture continues while a Snapshot is selected. A stopped Live session may enter Snapshot when it
has retained history; "Live" names the display edge, not a promise that capture is running.

The no-op cases do not switch source, stop FILE analysis, open PLVS, or raise a modal prompt. They
are silent so a global shortcut cannot unexpectedly surface a background workbench.

### Clear

Clear continues to invoke the existing `clearAll` business action and keeps its existing enablement
and source semantics. The new catalogue and router must not silently redefine it as one of the new
Live-only actions.

### Independent state axes

These four combinations are all valid:

| Live capture | Display  | Meaning                                                      |
| ------------ | -------- | ------------------------------------------------------------ |
| Running      | Live     | Measuring and displaying the current edge.                   |
| Running      | Snapshot | Measuring in the background while displaying a frozen point. |
| Stopped      | Live     | Displaying the latest retained Live result.                  |
| Stopped      | Snapshot | Inspecting a retained point while capture is stopped.        |

## Keyboard handling

- Ignore `KeyboardEvent.repeat` so holding a toggle chord cannot oscillate state.
- A matched shortcut prevents the browser default even when its business action resolves to a
  no-op. This keeps the configured chord owned by PLVS while the window is focused.
- Settings, Help, ordinary overlays and blocking Theme/Profile/Preset editors do not suppress these
  actions. None of the actions saves, cancels or replaces an editor draft.
- Modifier-bearing shortcut chords continue to work while an ordinary text field is focused,
  matching the existing Clear behavior.
- While any `ShortcutCapture` is recording, all configurable in-app dispatch and all global
  registrations are suspended. This prevents the chord being recorded from triggering an existing
  action. Fixed UI keys such as Escape retain their local component behavior.
- Native system dialogs keep their operating-system keyboard ownership.

## Settings design

The Keyboard Shortcuts section becomes a compact three-row table built from existing primitives:

```text
                         Shortcut                 Global
Start / Stop             [Ctrl+Shift+Space]       [switch]
Live / Snapshot          [Ctrl+Shift+L]           [switch]
Clear                     [Ctrl+K]                 [switch]
```

Each row uses `SettingsRow`, `ShortcutCapture`, `ResetAction` and `SettingsSwitch`. There is no new
globe icon, icon toggle, or shortcut-row interaction model.

`ShortcutCapture` becomes action-neutral:

- `aria-label` and descriptive text are passed by the caller instead of being fixed to Clear.
- A null accelerator renders as `Not Set`.
- Escape cancels capture.
- Delete or Backspace commits null, removing the binding.
- Other accepted chords retain the current modifier-plus-one-key validation.
- Reset restores the catalogue default, not necessarily null.

The column labels may be visually compact, but every switch has an explicit accessible name such
as `Start / Stop global shortcut`.

Registration and validation errors belong to the affected action row. A failed Global registration
leaves the requested Global value on, preserves in-app operation, and shows the existing
`Combo unavailable, try another` treatment for that row.

## Action catalogue

One shared catalogue owns identity, order, labels and defaults:

```js
export const SHORTCUT_ACTIONS = [
  {
    id: "toggleLiveCapture",
    label: "Start / Stop",
    defaultAccelerator: "CmdOrCtrl+Shift+Space",
  },
  {
    id: "toggleLiveSnapshot",
    label: "Live / Snapshot",
    defaultAccelerator: "CmdOrCtrl+Shift+L",
  },
  {
    id: "clear",
    label: "Clear",
    defaultAccelerator: "CmdOrCtrl+K",
  },
];
```

The action IDs are persistence and routing identifiers. Labels may change without migration.
Rendering order is catalogue order. Validation rejects unknown action IDs and duplicate non-null
accelerators across configurable actions, regardless of either action's Global setting.

Fixed application shortcuts remain outside this catalogue but participate in reserved-chord
validation when they are representable as configurable accelerators.

## Preference model and migration

The effective JavaScript model is:

```js
keyboardShortcuts: {
  toggleLiveCapture: {
    accelerator: "CmdOrCtrl+Shift+Space",
    global: false,
  },
  toggleLiveSnapshot: {
    accelerator: "CmdOrCtrl+Shift+L",
    global: false,
  },
  clear: {
    accelerator: "CmdOrCtrl+K",
    global: false,
  },
}
```

`accelerator` is a canonical Tauri accelerator string or null. `global` is boolean. Normalization
fills missing known actions from the catalogue, drops unknown actions, rejects malformed chords,
and forces `global: false` when `accelerator` is null.

The identity-wide persistence repository gains one `keyboardShortcuts` global-preference key. One
object and one revision make an action's accelerator and Global choice atomic and prevent partial
cross-workbench observation.

On a profile without `keyboardShortcuts`, hydration synthesizes the object from the legacy
`clearShortcut` and `clearGlobal` values plus the two new defaults. A stored `keyboardShortcuts`
object takes precedence. The legacy keys remain read-only migration inputs and are no longer
written. The next real shortcut edit persists the normalized object; migration itself need not
write during boot.

The global-preferences-changed event reloads and normalizes the complete object. A revision conflict
is reconciled by reloading before another user action rather than blindly overwriting another
workbench.

## Configuration profiles

Portable configuration profiles move to version 2 and export the same `keyboardShortcuts` object.
Version 1 remains importable:

- `clearShortcut` and `clearGlobal` become the `clear` action;
- the two new actions receive their built-in defaults;
- malformed legacy Clear values fall back to the Clear defaults.

Version 2 import normalizes every known action and ignores no malformed value silently: the shared
profile normalizer supplies safe defaults just as it does for existing preference fields. Reset to
Default installs the complete default object. Browser-mode export uses the same shape.

## Registration and dispatch architecture

The Clear-specific preference module and hook become an action-neutral shortcut owner. It holds:

- normalized preferences;
- readiness and capture state;
- one registration result per action;
- the coordinator-owned set of registered OS accelerators;
- GUI and Agent Control setters that persist the whole object atomically.

The in-app listener finds the configured action by accelerator and dispatches its action ID. A ref
owned by `SettingsProvider` bridges the outer registration owner to business actions mounted inside
`SourceActionsProvider`, generalizing the current Clear ref without moving transport logic into
Settings.

Global registration remains coordinator-only. The coordinator registers each action whose Global
value is true and accelerator is non-null. A handler routes `{ actionId }` to the most recently
focused workbench using the existing target selection rule. The local target invokes the same
business action as the in-app listener. A remote target uses the existing revisioned Agent Control
transport surface to inspect state and perform the explicit operation needed by the toggle.

Remote toggle routing follows the same no-op rules before issuing a command:

- Start / Stop inspects source and Live lifecycle, then selects `transport.live.start` or
  `transport.live.stop` only for a settled LIVE lifecycle.
- Live / Snapshot inspects source, Snapshot state and history availability, then selects
  `transport.snapshot.select` with offset zero or `transport.snapshot.clear` only for LIVE.
- Clear preserves the existing remote Clear target and semantics.

Routing an expected no-op succeeds without mutating revision. A routing or command failure is
logged consistently with the existing global Clear behavior and must not fall through to another
workbench.

Changing one Global chord must not unnecessarily unregister unrelated actions. When replacing a
registered chord, reserve the new chord before releasing the old one where possible. A multi-action
Agent Control update is atomic at the public contract: on registration or persistence failure,
restore prior registrations and preferences. Swapping two PLVS-owned chords may temporarily release
the affected pair, but must roll back both on failure.

## Agent Control

Settings Control replaces the Clear-specific public field with the catalogue-shaped
`keyboardShortcuts` field. Each known action is a merge-patched object containing `accelerator` and
`global`; omitted actions and members retain their current values. Null is accepted only for
`accelerator` and forces the resulting Global value off.

Inspection reports per-action runtime registration as `active`, `notRequested` or `unavailable`,
and availability becomes action-neutral shortcut readiness/capture state. Cross-action duplicate
accelerators are rejected as `invalidShortcut`. A patch touching shortcuts while GUI capture is
active is refused with `shortcutCaptureActive`.

The Clear-only public field is removed rather than retained as a second writable alias. PLVS is
pre-1.0 and the configuration profile migration, not duplicate Agent Control controls, owns stored
compatibility. Generated Agent Control reference pages and the hand-written Settings semantics are
updated in the implementation change.

## Failure behavior

- One action's OS registration failure does not disable another action or in-app shortcuts.
- A requested Global value remains visible after registration failure.
- Removing an accelerator unregisters it and forces Global off.
- Duplicate configured accelerators are rejected before persistence or registration.
- An unavailable remote target does not redirect the action to the coordinator workbench.
- Shortcut preference load failure uses the full default catalogue and Global off.
- Unmount and coordinator demotion release every accelerator owned by that process.

## Documentation impact

The implementation updates:

- `docs/user/system-settings.md` for all configurable and Global shortcuts;
- `docs/user/workspace.md` for the two toggle semantics and their independence;
- `docs/architecture.md` for catalogue ownership, dispatch and multi-instance routing;
- `docs/agent-control/settings.md` and generated Settings reference;
- configuration-profile documentation if its public schema examples enumerate shortcut fields.

## Acceptance criteria

- Fresh installs expose the three default accelerators above with Global off.
- Existing Clear customization and Global choice survive upgrade.
- Each accelerator can be changed, removed, reset and independently made Global.
- Duplicate configurable chords cannot be saved.
- Start / Stop changes only settled LIVE capture lifecycle and never leaves Snapshot.
- Live / Snapshot freezes offset zero or returns to the Live edge without changing capture.
- Both new actions are silent no-ops in FILE and during invalid transition/history states.
- Holding a chord produces at most one toggle per physical press.
- Shortcut recording cannot trigger any configurable local or Global action.
- Multiple workbenches register each Global chord once and route it to the most recently focused
  workbench.
- A registration failure is isolated to its action and leaves the old effective registration safe.
- Profile v1 import, profile v2 round trip, Reset to Default and multi-instance persistence retain
  normalized shortcut state.
- Settings Control, generated docs and GUI controls expose the same action set and defaults.
