# View Control

Status: Implemented

View Control exposes the persistent working-view state shown in the GUI's Views popover. These
values are part of the scene captured by Presets, but they are not ordinary global Settings and
currently have no focused Agent Control surface.

## Commands

```powershell
npm run desktop:control -- view describe --json
npm run desktop:control -- view inspect --json
npm run desktop:control -- view update <file|-> --expected-revision 12 --json
npm run desktop:control -- view reset --expected-revision 12 --json
```

`describe` returns schema, current values, platform availability, and runtime application state.
`inspect` returns the focused current snapshot without field schema. `update` applies an atomic
direct-field patch. `reset` restores View defaults. Both mutations require expected revision and
support dry-run. The generated field table is in [`generated/view.md`](generated/view.md).

## Public state

View Control uses the same public names already returned by `preset describe`:

```json
{
  "pinned": false,
  "focusView": {
    "autoHideControls": false,
    "compactPanels": false,
    "borderless": false
  },
  "panelOpacity": 100,
  "glassEnabled": false
}
```

- `pinned` is the GUI's **Always on Top** value. The established Preset spelling is retained so
  one scene concept does not acquire two public names.
- `focusView` is merge-patched. Omitted members retain their current values. Each member is a
  boolean.
- `panelOpacity` is an integer percentage from 0 through 100. Strict writes reject fractions,
  numeric strings, and out-of-range values instead of using the persistence loader's rounding and
  clamping behavior.
- `glassEnabled` is a boolean stored with the scene. It is writable only on macOS, where the GUI
  exposes Glass and the native effect exists.

An empty update is a successful no-op. Unknown fields, wrong types, unavailable fields, and
out-of-range values fail atomically under `invalidView` with the standard issue list. Null is not a
general reset operator.

## Platform and Dock state

Inspection reports stored/requested View values even when the current window form temporarily
owns different native presentation. Related runtime data states whether normal presentation is
active or suspended by Dock. `describe` and mutation results report field availability separately.

On non-macOS platforms, `glassEnabled` is readable for portable configuration and Preset
round-tripping but is not writable. An explicit update touching it fails with
`controlUnavailable`; it is not silently accepted as a native no-op. `view reset` may clear a stale
stored true value to the portable default even where Glass is unsupported.

While Dock is active, Rust owns topmost state and window chrome. Updates to `pinned`,
`focusView.autoHideControls`, or `focusView.borderless` remain valid stored-scene changes but do not
fight the Dock window form. A changed touched field that is dormant for this reason returns a
`currentlyInactive` warning with reason `dockOwnsWindowPresentation`. The stored values are
reasserted through the existing Dock exit path. `focusView.compactPanels` and `panelOpacity` remain
ordinary frontend presentation values.

View Control does not enter, exit, or reconfigure Dock; that remains exclusively
[Dock Control](dock.md).

## Mutation behavior

Planning uses strict public validation and computes the complete final View before any side effect.
A dry-run performs the same revision, availability, final-state, warning, and changed-path
calculation without calling native window APIs, mutating React or persistence, marking a Preset
dirty, or incrementing revision.

A successful real mutation means that applicable native presentation, React state, Preset dirty
state, and durable persistence have settled. GUI and Agent Control must share the same business
functions for:

- applying or suspending Always on Top;
- applying window decorations derived from Auto-hide Controls and Borderless;
- applying or clearing macOS Glass;
- committing Focus View and panel opacity.

The Agent Control path must not call the current GUI hooks and then assume their fire-and-forget
effects succeeded. Native failures that those hooks presently suppress must become observable to
the shared control function.

Predictable validation, revision, availability, and no-op outcomes have no side effects. Native
operations are attempted in a reversible order before the public state is committed. If a later
stage fails, the command performs best-effort compensation and reports `applicationFailed`,
`partial`, `rollback`, changed public paths, and current revision using the same failure vocabulary
as Settings Control. A persistence failure after committed View state reports
`persistenceFailed`, `stateCommitted: true`, and the resulting revision.

## Reset

`view reset` restores:

```json
{
  "pinned": false,
  "focusView": {
    "autoHideControls": false,
    "compactPanels": false,
    "borderless": false
  },
  "panelOpacity": 100,
  "glassEnabled": false
}
```

It does not change Dock, window geometry, Workspace layout, panel sizes, fullscreen state, Theme,
or capture state. Reset uses the same dry-run, native-settlement, no-op, warning, persistence, and
failure semantics as update.

## Presets, editors, and revision

An effective View change follows the GUI and marks Preset state dirty. A no-op does not. Opening a
Theme or Loudness Profile editor does not block View Control because these
operations neither capture nor replace the scene and do not discard the draft.

View changes from either GUI or Agent Control increment the single process-local global revision.
One atomic update increments it once even when several View fields and Preset dirty state change
together. Dry-run, no-op, validation failure, and native failure restored by compensation do not
increment it. A committed partial result increments it according to the resulting observable
state.

`app.inspect` gains the compact `view` snapshot when this family is implemented. Successful
mutations return `dryRun`, boolean `changed`, `revision`, changed-path-derived effects and warnings,
the complete resulting `state.view`, related runtime/availability, and compact Preset state.

## Deliberate exclusions

- Window bounds, maximized state, monitor placement, and window movement. Native geometry and
  chrome ordering require a separate Window Control decision.
- Workspace panel-size pins. They belong to Workspace structure, despite sharing the word
  "pinned" internally.
- Fullscreen, active tabs, open popovers/sheets/editors, hover state, and whether auto-hidden chrome
  is visible at this instant. These are transient UI state.
- Dock configuration, which already has its own public resource.
